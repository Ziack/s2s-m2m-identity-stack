/**
 * Broker-aware auth middleware for the ledger-service.
 *
 * Ledger is the terminal hop in the sync chain `calling → receiving → ledger`.
 * It validates broker-issued tokens (RFC 8693 exchanged tokens) against the
 * broker's JWKS, extracts user identity + actor-chain, and passes both into
 * the AVP `IsAuthorizedWithToken` context map (Phase 5).
 *
 * No outbound exchange is required — ledger does not call further downstream.
 *
 * Implementation mirrors receiving-service's brokerAuthMiddleware. The two
 * are intentionally kept as parallel copies (rather than extracted into the
 * SDK) so service-specific extensions (e.g. ledger-only context fields) can
 * be added without coupling.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import {
  VerifiedPermissionsClient,
  IsAuthorizedCommand,
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
import type { LedgerServiceConfig } from '../config.js';
import { createNonceStore } from './nonceStore.js';

type ErrorCodeValue = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const MAX_ACTOR_CHAIN_DEPTH = 5;

export function actorChainAsString(chain: ActorChain | null): string[] {
  if (!chain) return [];
  const out: string[] = [];
  let node: ActorChain | undefined = chain;
  while (node) {
    out.push(node.sub);
    node = node.act;
  }
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
    expectedJkt?: string | undefined;
    requireCnfBinding?: boolean;
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
  /** Cedar schema action ID for this route, e.g. "POST_ledger_entry". */
  action: string;
  /** Cedar ResourceGroup entity ID for this route, e.g. "ledger-resources". */
  resourceGroup: string;
}

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
  challengeNonce?: string,
): void {
  res.setHeader('WWW-Authenticate', wwwAuthenticateHeader(code));
  // RFC 9449: surface the DPoP nonce challenge so the caller can retry with a
  // proof bound to it. Without this header the nonce-retry handshake stalls.
  if (challengeNonce) {
    res.setHeader('DPoP-Nonce', challengeNonce);
  }
  res.status(status).json(buildErrorBody({ code, description, requestId }));
}

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
      // RFC 9449 §6 hard-enforce: the resource-call proof key MUST match the
      // token's cnf.jkt, and the token MUST carry one. validateToken ran above
      // so cnf.jkt is available. A stolen token replayed with a different key
      // (or a token without cnf.jkt) is rejected with dpop_key_mismatch (401).
      // The nonce challenge inside verifyDPoP still fires first for
      // first-contact callers, so the nonce-retry handshake is preserved.
      await deps.verifyDPoP({
        dpopProof: dpopHeader,
        accessToken,
        expectedHtm: req.method.toUpperCase(),
        expectedHtu: htu,
        expectedJkt: validated.cnf?.jkt,
        requireCnfBinding: true,
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

      const principal = `M2M::ServicePrincipal::${validated.sub}`;
      const action = `M2M::Action::${deps.action}`;
      const resource = `M2M::ResourceGroup::${deps.resourceGroup}`;

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
      (req as Request & { auth: typeof extended }).auth = extended;
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        send(res, err.status, err.code, err.message, requestId, err.challengeNonce);
        return;
      }
      send(res, 401, ERROR_CODES.INVALID_TOKEN, (err as Error).message, requestId);
    }
  };
}

export function buildBrokerAuthMiddleware(
  config: LedgerServiceConfig,
  binding: { action: string; resourceGroup: string },
): RequestHandler {
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
    async isAuthorized(
      input: Parameters<NonNullable<Parameters<typeof createAuthorize>[0]['avpClient']['isAuthorized']>>[0],
    ) {
      const resp = await avpRaw.send(
        new IsAuthorizedCommand({
          policyStoreId: input.PolicyStoreId,
          principal: { entityType: input.Principal.EntityType, entityId: input.Principal.EntityId },
          action: { actionType: input.Action.ActionType, actionId: input.Action.ActionId },
          resource: { entityType: input.Resource.EntityType, entityId: input.Resource.EntityId },
          ...(input.Context ? { context: { contextMap: input.Context.ContextMap } } : {}),
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
    avpApi: 'entity',
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
    sourceDomain: 'ledger',
    action: binding.action,
    resourceGroup: binding.resourceGroup,
  });
}
