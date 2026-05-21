/**
 * Broker-aware auth middleware for synchronous, DPoP-bound requests carrying
 * broker-issued (RFC 8693 token-exchange) tokens.
 *
 * Differences vs `buildAuthMiddleware`:
 *   - JWKS source: token-broker (`BROKER_JWKS_URI`) rather than Cognito.
 *   - Expected issuer + audience: broker identifiers.
 *   - Extracts user identity (`UserContext`) + RFC 8693 `act` chain
 *     (`ActorChain`) from the validated claims and propagates them into:
 *       1. `req.auth.user` / `req.auth.actor_chain` for downstream handlers
 *       2. The AVP `IsAuthorizedWithToken` `context` map so Cedar policies
 *          can authorise on user role / actor chain (Phase 5).
 *
 * Single-actor mode: the middleware does NOT validate chain shape beyond a
 * sanity cap of 5 hops (defence against malformed or pathological tokens).
 *
 * The legacy `buildAuthMiddleware` is left in place for the async / envelope
 * paths which still use Cognito-issued M2M tokens.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import {
  VerifiedPermissionsClient,
  IsAuthorizedWithTokenCommand,
} from '@aws-sdk/client-verifiedpermissions';
import {
  createJwksManager,
  createValidateToken,
  createVerifyDPoP,
  createAuthorize,
  createCedarLocal,
  getRedisClient,
  extractActorChain,
  AuthError,
  ERROR_CODES,
  buildErrorBody,
  wwwAuthenticateHeader,
} from '@s2s/auth-library';
import type {
  UserContext,
  ActorChain,
  ValidatedToken,
} from '@s2s/auth-library';

type ErrorCodeValue = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
import type { ReceivingServiceConfig } from '../config.js';
import { createNonceStore } from './nonceStore.js';

/** Maximum supported actor-chain depth — defensive sanity cap. */
export const MAX_ACTOR_CHAIN_DEPTH = 5;

/**
 * Flatten an ActorChain into an ordered list of subs, innermost (oldest)
 * first → outermost (current actor) last. Returns an empty array if `null`.
 */
export function actorChainAsString(chain: ActorChain | null): string[] {
  if (!chain) return [];
  const out: string[] = [];
  let node: ActorChain | undefined = chain;
  while (node) {
    out.push(node.sub);
    node = node.act;
  }
  // The recursive walk above produces outermost → innermost (because each
  // `node.act` is the *previous* hop wrapping this one). Reverse so the result
  // is innermost-first per the doc string.
  return out.reverse();
}

function chainDepth(chain: ActorChain | null): number {
  if (!chain) return 0;
  let depth = 0;
  let node: ActorChain | undefined = chain;
  while (node) {
    depth += 1;
    node = node.act;
  }
  return depth;
}

export interface BrokerAuthDeps {
  validateToken: (
    token: string,
    options: { expectedAudience: string },
  ) => Promise<ValidatedToken>;
  verifyDPoP: (input: {
    dpopProof: string;
    accessToken: string;
    expectedHtm: string;
    expectedHtu: string;
  }) => Promise<unknown>;
  authorize: (input: {
    principal: string;
    action: string;
    resource: string;
    token: string;
    context?: Record<string, unknown>;
  }) => Promise<{ decision: 'ALLOW' | 'DENY'; reasons: string[] }>;
  expectedAudience: string;
  resourcePrefix: string;
  sourceDomain: string;
}

/**
 * Phase-4 extension shape attached to `req.auth` in addition to the SDK's
 * base `{ sub, scopes, decision, reasons }`. We do NOT redeclare the
 * Express Request module augmentation here because the SDK already does so
 * with a narrower type; downstream handlers read these extras through the
 * `AuthedReq` cast below.
 */
export interface BrokerAuthExtras {
  user: UserContext;
  actor_chain: ActorChain | null;
  token: string;
}

function send(
  res: Response,
  status: number,
  code: ErrorCodeValue,
  description: string,
  requestId: string,
): void {
  res.setHeader('WWW-Authenticate', wwwAuthenticateHeader(code));
  res.status(status).json(buildErrorBody({ code, description, requestId }));
}

/**
 * Lower-level factory consumed by tests that want to inject doubles for
 * validate/verifyDPoP/authorize. Production callers use `buildBrokerAuthMiddleware`.
 */
export function createBrokerAuthMiddleware(deps: BrokerAuthDeps): RequestHandler {
  return async function brokerAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    try {
      const authHeader = (req.headers.authorization ?? '') as string;
      const dpopHeader = (req.headers.dpop ?? '') as string;
      if (!authHeader) {
        send(res, 401, ERROR_CODES.INVALID_TOKEN, 'missing Authorization header', requestId);
        return;
      }
      const m = authHeader.match(/^(?:DPoP|Bearer)\s+(.+)$/i);
      if (!m) {
        send(res, 401, ERROR_CODES.INVALID_TOKEN, 'malformed Authorization header', requestId);
        return;
      }
      const accessToken = m[1] as string;

      const validated = await deps.validateToken(accessToken, {
        expectedAudience: deps.expectedAudience,
      });

      if (!dpopHeader) {
        send(res, 401, ERROR_CODES.INVALID_DPOP_PROOF, 'missing DPoP header', requestId);
        return;
      }
      const host = req.get('host') ?? '';
      const htu = `${req.protocol}://${host}${req.originalUrl.split('?')[0]}`;
      await deps.verifyDPoP({
        dpopProof: dpopHeader,
        accessToken,
        expectedHtm: req.method.toUpperCase(),
        expectedHtu: htu,
      });

      const claims = validated.raw;
      const actorChain = extractActorChain(claims);
      if (!actorChain) {
        send(
          res,
          401,
          ERROR_CODES.INVALID_TOKEN,
          'broker-issued token missing act claim',
          requestId,
        );
        return;
      }
      if (chainDepth(actorChain) > MAX_ACTOR_CHAIN_DEPTH) {
        send(
          res,
          401,
          ERROR_CODES.INVALID_TOKEN,
          `actor chain exceeds maximum depth of ${MAX_ACTOR_CHAIN_DEPTH}`,
          requestId,
        );
        return;
      }

      const rolesRaw = claims.roles;
      const groupsRaw = claims.groups;
      const userContext: UserContext = {
        sub: validated.sub,
        roles: Array.isArray(rolesRaw)
          ? rolesRaw.filter((r): r is string => typeof r === 'string')
          : [],
        groups: Array.isArray(groupsRaw)
          ? groupsRaw.filter((g): g is string => typeof g === 'string')
          : [],
        claims,
        issuer: validated.iss,
      };

      const principal = `ServicePrincipal::${validated.sub}`;
      const pathForResource = req.path ?? (req.originalUrl ?? '').split('?')[0] ?? '';
      const action = `Action::${req.method.toUpperCase()}_${(req.route?.path ?? pathForResource).replace(/[^A-Za-z0-9]/g, '_')}`;
      const resource = `${deps.resourcePrefix}::${pathForResource}`;

      const correlationId =
        (req.headers['x-correlation-id'] as string | undefined) ??
        (req.headers['x-request-id'] as string | undefined) ??
        requestId;

      const context: Record<string, unknown> = {
        dpop_confirmed: true,
        scopes: validated.scope,
        source_domain: deps.sourceDomain,
        correlation_id: correlationId,
        user: {
          sub: userContext.sub,
          roles: userContext.roles,
          groups: userContext.groups,
        },
        actor_chain: actorChainAsString(actorChain),
      };

      const decision = await deps.authorize({
        principal,
        action,
        resource,
        token: accessToken,
        context,
      });

      if (decision.decision !== 'ALLOW') {
        send(
          res,
          403,
          ERROR_CODES.AUTHORIZATION_DENIED,
          decision.reasons.join(',') || 'denied',
          requestId,
        );
        return;
      }

      const extended: {
        sub: string;
        scopes: string[];
        decision: 'ALLOW' | 'DENY';
        reasons: string[];
      } & BrokerAuthExtras = {
        sub: validated.sub,
        scopes: validated.scope,
        decision: decision.decision,
        reasons: decision.reasons,
        user: userContext,
        actor_chain: actorChain,
        token: accessToken,
      };
      // Assign through a cast — SDK's module augmentation does not include
      // the broker-specific extras (`user`, `actor_chain`, `token`).
      (req as Request & { auth: typeof extended }).auth = extended;
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        send(res, err.status, err.code, err.message, requestId);
        return;
      }
      send(res, 401, ERROR_CODES.INVALID_TOKEN, (err as Error).message, requestId);
    }
  };
}

/**
 * Build a broker-aware middleware wired to real SDK factories and the
 * configured AVP policy store. Used in production.
 */
export function buildBrokerAuthMiddleware(config: ReceivingServiceConfig): RequestHandler {
  const redis = getRedisClient(config.redisEndpoint);
  const nonceStore = createNonceStore(config.redisEndpoint);

  const jwksManager = createJwksManager({
    jwksUri: config.brokerJwksUri,
    refreshHours: config.jwksRefreshHours,
  });
  const validateToken = createValidateToken({
    jwksManager,
    expectedIssuer: config.brokerIssuer,
  });
  const verifyDPoP = createVerifyDPoP({
    redis,
    nonceStore,
    requireNonce: true,
    nonceTtlSeconds: config.nonceTtlSeconds,
  });

  const avpRaw = new VerifiedPermissionsClient({ region: config.awsRegion });
  const avpClient = {
    async isAuthorizedWithToken(
      input: Parameters<Parameters<typeof createAuthorize>[0]['avpClient']['isAuthorizedWithToken']>[0],
    ) {
      const resp = await avpRaw.send(
        new IsAuthorizedWithTokenCommand({
          policyStoreId: input.PolicyStoreId,
          accessToken: input.AccessToken,
          identityToken: input.IdentityToken,
          action: { actionType: input.Action.ActionType, actionId: input.Action.ActionId },
          resource: { entityType: input.Resource.EntityType, entityId: input.Resource.EntityId },
          ...(input.Context
            ? { context: { contextMap: input.Context.ContextMap as Record<string, never> } }
            : {}),
        }),
      );
      return {
        Decision: (resp.decision === 'ALLOW' ? 'ALLOW' : 'DENY') as 'ALLOW' | 'DENY',
        DeterminingPolicies: (resp.determiningPolicies ?? []).map((p) => ({
          PolicyId: p.policyId ?? '',
        })),
      };
    },
  };

  const cedarLocal = createCedarLocal([]);
  const authorize = createAuthorize({
    mode: 'avp_api',
    policyStoreId: config.policyStoreId,
    avpClient,
    cedarLocal,
    fallbackToLocal: false,
  });

  return createBrokerAuthMiddleware({
    validateToken,
    verifyDPoP,
    authorize,
    expectedAudience: config.brokerAudience,
    resourcePrefix: config.resourcePrefix,
    sourceDomain: 'receiving',
  });
}
