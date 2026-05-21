import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthError, ERROR_CODES, buildErrorBody, wwwAuthenticateHeader, type ErrorCode } from './errors.js';
import type { ValidatedToken, DPoPVerificationResult, AuthorizationResult } from './types.js';

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
      const authHeader = (req.headers.authorization ?? '') as string;
      const dpopHeader = (req.headers.dpop ?? '') as string;
      if (!authHeader) { reject(401, ERROR_CODES.INVALID_TOKEN, 'missing Authorization header'); return; }
      const m = authHeader.match(/^(?:DPoP|Bearer)\s+(.+)$/i);
      if (!m) { reject(401, ERROR_CODES.INVALID_TOKEN, 'malformed Authorization header'); return; }
      const accessToken = m[1] as string;

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

// Alias with the spec-documented name.
export const createBrokerAuthMiddleware = createAuthMiddleware;
