import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthError, ERROR_CODES, buildErrorBody, wwwAuthenticateHeader, type ErrorCode } from './errors.js';
import type { ValidatedToken, DPoPVerificationResult, AuthorizationResult } from './types.js';
import { createJwksManager } from './validation/jwksManager.js';
import { createValidateToken } from './validation/validateToken.js';
import { createVerifyDPoP } from './dpop/verifyDPoP.js';
import { createRedisNonceStore } from './dpop/dpopNonce.js';
import { createAuthorize, type AvpClientLike } from './authz/authorize.js';
import { createCedarLocal } from './authz/cedarLocal.js';
import { getRedisClient } from './redisClient.js';
import { DPOP_TOKEN_HEADER } from './lattice/sigv4Client.js';

/** Lower-cased {@link DPOP_TOKEN_HEADER} for indexing into Express's normalized headers. */
const DPOP_TOKEN_HEADER_LC = DPOP_TOKEN_HEADER.toLowerCase();

export type BrokerAuthMode = 'log-only' | 'enforce';

export interface AuthMiddlewareDeps {
  expectedAudience: string;
  resourcePrefix: string;
  validateToken: (token: string, options: { expectedAudience: string }) => Promise<ValidatedToken>;
  verifyDPoP: (input: { dpopProof: string; accessToken: string; expectedHtm: string; expectedHtu: string }) => Promise<DPoPVerificationResult>;
  authorize: (input: { principal: string; action: string; resource: string; token: string; context?: Record<string, unknown> }) => Promise<AuthorizationResult>;
  requireDPoP?: boolean;
  mode?: BrokerAuthMode;
  logger?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
  metrics?: { m2mShadowModeDecisionsTotal?: { inc: (labels: { decision: string; result: string }) => void } };
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      sub: string;
      scopes: string[];
      decision: 'ALLOW' | 'DENY';
      reasons: string[];
    };
  }
}

function send(res: Response, status: number, code: ErrorCode, description: string, requestId: string): void {
  res.setHeader('WWW-Authenticate', wwwAuthenticateHeader(code));
  res.status(status).json(buildErrorBody({ code, description, requestId }));
}

export function createAuthMiddleware(deps: AuthMiddlewareDeps): RequestHandler {
  const mode: BrokerAuthMode = deps.mode ?? 'enforce';
  const log = deps.logger ?? { info: () => {}, warn: () => {} };
  const incShadow = (decision: string, result: string): void => {
    deps.metrics?.m2mShadowModeDecisionsTotal?.inc({ decision, result });
  };

  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();

    const reject = (status: number, code: ErrorCode, description: string): void => {
      if (mode === 'log-only') {
        log.warn({ requestId, code, description, shadow_mode: true }, 'shadow_mode would_reject');
        incShadow('INVALID', 'would_reject');
        next();
        return;
      }
      send(res, status, code, description, requestId);
    };

    try {
      const dpopHeader = (req.headers.dpop ?? '') as string;

      // Token source resolution (Lattice contract):
      //   1. `X-DPoP-Token` (DPOP_TOKEN_HEADER) — used behind VPC Lattice, where
      //      the `Authorization` header is occupied by the SigV4 credential.
      //   2. Fallback: `Authorization: DPoP <token>` / `Bearer <token>` — for
      //      direct (non-Lattice) callers. Back-compat path.
      // Only the token SOURCE differs; DPoP proof + all verification is unchanged.
      let accessToken: string;
      const dpopTokenHeader = (req.headers[DPOP_TOKEN_HEADER_LC] ?? '') as string;
      if (dpopTokenHeader) {
        // X-DPoP-Token carries the bare token (no scheme prefix). Tolerate an
        // accidental `DPoP `/`Bearer ` prefix defensively.
        const xm = dpopTokenHeader.match(/^(?:DPoP|Bearer)\s+(.+)$/i);
        accessToken = (xm ? xm[1] : dpopTokenHeader.trim()) as string;
        if (!accessToken) { reject(401, ERROR_CODES.INVALID_TOKEN, `malformed ${DPOP_TOKEN_HEADER} header`); return; }
      } else {
        const authHeader = (req.headers.authorization ?? '') as string;
        if (!authHeader) { reject(401, ERROR_CODES.INVALID_TOKEN, 'missing access token'); return; }
        const m = authHeader.match(/^(?:DPoP|Bearer)\s+(.+)$/i);
        if (!m) { reject(401, ERROR_CODES.INVALID_TOKEN, 'malformed Authorization header'); return; }
        accessToken = m[1] as string;
      }

      const validated = await deps.validateToken(accessToken, { expectedAudience: deps.expectedAudience });

      const requireDPoP = deps.requireDPoP !== false;
      if (requireDPoP) {
        if (!dpopHeader) { reject(401, ERROR_CODES.INVALID_DPOP_PROOF, 'missing DPoP header'); return; }
        const host = req.get('host') ?? '';
        const htu = `${req.protocol}://${host}${req.originalUrl.split('?')[0]}`;
        await deps.verifyDPoP({ dpopProof: dpopHeader, accessToken, expectedHtm: req.method.toUpperCase(), expectedHtu: htu });
      }

      const principal = `ServicePrincipal::${validated.sub}`;
      const pathForResource = req.path ?? (req.originalUrl ?? '').split('?')[0] ?? '';
      const action = `Action::${req.method.toUpperCase()}_${(req.route?.path ?? pathForResource).replace(/[^A-Za-z0-9]/g, '_')}`;
      const resource = `${deps.resourcePrefix}::${pathForResource}`;
      const decision = await deps.authorize({
        principal, action, resource, token: accessToken,
        context: { dpop_confirmed: requireDPoP, scopes: validated.scope },
      });

      if (mode === 'log-only') {
        log.info({
          requestId, shadow_mode: true,
          sub: validated.sub,
          actor_chain: (validated as { actor_chain?: string[] }).actor_chain ?? [],
          decision: decision.decision, reasons: decision.reasons,
        }, 'shadow_mode decision');
        incShadow(decision.decision, decision.decision === 'ALLOW' ? 'would_allow' : 'would_deny');
        req.auth = { sub: validated.sub, scopes: validated.scope, decision: decision.decision, reasons: decision.reasons };
        next();
        return;
      }

      if (decision.decision !== 'ALLOW') {
        send(res, 403, ERROR_CODES.AUTHORIZATION_DENIED, decision.reasons.join(',') || 'denied', requestId);
        return;
      }
      req.auth = { sub: validated.sub, scopes: validated.scope, decision: decision.decision, reasons: decision.reasons };
      next();
    } catch (err) {
      if (err instanceof AuthError) { reject(err.status, err.code, err.message); return; }
      reject(401, ERROR_CODES.INVALID_TOKEN, (err as Error).message);
    }
  };
}

/**
 * High-level configuration accepted by {@link createBrokerAuthMiddleware} when
 * a service wants to construct the middleware purely from broker / AVP URLs
 * (rather than passing in pre-constructed `validateToken`/`verifyDPoP`/`authorize`
 * functions).
 *
 * Used by the `@s2s/create-service` app template (`src/lib/auth.ts`).
 */
export interface BrokerAuthConfig {
  brokerJwksUri: string;
  brokerIssuer: string;
  brokerAudience: string;
  policyStoreId: string;
  resourcePrefix: string;
  /** AWS region used to construct the VerifiedPermissionsClient. */
  awsRegion: string;
  /** ioredis endpoint used to back the DPoP nonce store + replay check. */
  redisEndpoint: string;
  mode?: BrokerAuthMode;
  requireDPoP?: boolean;
  /** Refresh interval for the JWKS cache. Default: 24h. */
  jwksRefreshHours?: number;
  /** DPoP nonce TTL (seconds). Default: 120. */
  nonceTtlSeconds?: number;
  /** Prefix used by the Redis DPoP nonce store keys. Default: 'dpop:nonce:'. */
  nonceKeyPrefix?: string;
  logger?: AuthMiddlewareDeps['logger'];
  metrics?: AuthMiddlewareDeps['metrics'];
  /** Test seam — override the JWKS fetcher. */
  _fetchImpl?: typeof fetch;
  /** Test seam — override the AVP client (bypass AWS SDK construction). */
  _avpClient?: AvpClientLike;
}

function isBrokerAuthConfig(x: AuthMiddlewareDeps | BrokerAuthConfig): x is BrokerAuthConfig {
  return typeof (x as BrokerAuthConfig).brokerJwksUri === 'string';
}

function buildAvpClient(awsRegion: string): AvpClientLike {
  // Lazy-load the AWS SDK so projects that supply `_avpClient` (tests) or
  // never instantiate the high-level form never pay the import cost. We
  // intentionally require() at call-time inside an async closure to keep the
  // ESM build simple.
  let send: ((cmd: unknown) => Promise<unknown>) | null = null;
  let CommandCtor: (new (input: unknown) => unknown) | null = null;
  async function lazyInit(): Promise<void> {
    if (send && CommandCtor) return;
    const mod = await import('@aws-sdk/client-verifiedpermissions');
    const client = new mod.VerifiedPermissionsClient({ region: awsRegion });
    send = (cmd: unknown) => (client as unknown as { send: (c: unknown) => Promise<unknown> }).send(cmd);
    CommandCtor = mod.IsAuthorizedWithTokenCommand as unknown as new (input: unknown) => unknown;
  }
  return {
    async isAuthorizedWithToken(input) {
      await lazyInit();
      const resp = (await send!(new CommandCtor!({
        policyStoreId: input.PolicyStoreId,
        accessToken: input.AccessToken,
        identityToken: input.IdentityToken,
        action: { actionType: input.Action.ActionType, actionId: input.Action.ActionId },
        resource: { entityType: input.Resource.EntityType, entityId: input.Resource.EntityId },
        ...(input.Context
          ? { context: { contextMap: input.Context.ContextMap as Record<string, never> } }
          : {}),
      }))) as { decision?: string; determiningPolicies?: Array<{ policyId?: string }> };
      return {
        Decision: (resp.decision === 'ALLOW' ? 'ALLOW' : 'DENY') as 'ALLOW' | 'DENY',
        DeterminingPolicies: (resp.determiningPolicies ?? []).map((p) => ({ PolicyId: p.policyId ?? '' })),
      };
    },
  };
}

function wireBrokerAuthConfig(cfg: BrokerAuthConfig): AuthMiddlewareDeps {
  const jwksManager = createJwksManager({
    jwksUri: cfg.brokerJwksUri,
    refreshHours: cfg.jwksRefreshHours ?? 24,
    ...(cfg._fetchImpl !== undefined ? { fetchImpl: cfg._fetchImpl } : {}),
  });
  const validateToken = createValidateToken({
    jwksManager,
    expectedIssuer: cfg.brokerIssuer,
  });

  const redis = getRedisClient(cfg.redisEndpoint);
  const nonceStore = createRedisNonceStore({
    redis,
    ttlSeconds: cfg.nonceTtlSeconds ?? 300,
    prefix: cfg.nonceKeyPrefix ?? 'dpop:nonce:',
  });
  const verifyDPoP = createVerifyDPoP({
    redis,
    nonceStore,
    requireNonce: true,
    ...(cfg.nonceTtlSeconds !== undefined ? { nonceTtlSeconds: cfg.nonceTtlSeconds } : {}),
  });

  const avpClient = cfg._avpClient ?? buildAvpClient(cfg.awsRegion);
  const cedarLocal = createCedarLocal([]);
  const authorize = createAuthorize({
    mode: 'avp_api',
    policyStoreId: cfg.policyStoreId,
    avpClient,
    cedarLocal,
    fallbackToLocal: false,
  });

  return {
    expectedAudience: cfg.brokerAudience,
    resourcePrefix: cfg.resourcePrefix,
    validateToken,
    verifyDPoP,
    authorize,
    requireDPoP: cfg.requireDPoP ?? true,
    ...(cfg.mode !== undefined ? { mode: cfg.mode } : {}),
    ...(cfg.logger !== undefined ? { logger: cfg.logger } : {}),
    ...(cfg.metrics !== undefined ? { metrics: cfg.metrics } : {}),
  };
}

/**
 * Spec-documented broker-auth middleware factory.
 *
 * Two call shapes are supported:
 *   1. {@link AuthMiddlewareDeps} — full deps (used by existing call sites + tests
 *      that wire `validateToken`, `verifyDPoP`, `authorize` directly).
 *   2. {@link BrokerAuthConfig} — high-level config (URLs + policy store id);
 *      the middleware constructs the underlying deps internally. This is the
 *      shape the `@s2s/create-service` app template generates.
 */
export function createBrokerAuthMiddleware(input: AuthMiddlewareDeps | BrokerAuthConfig): RequestHandler {
  if (isBrokerAuthConfig(input)) {
    return createAuthMiddleware(wireBrokerAuthConfig(input));
  }
  return createAuthMiddleware(input);
}
