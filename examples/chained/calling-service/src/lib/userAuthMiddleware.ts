/**
 * Express middleware that validates an incoming user JWT against the local
 * IdP's JWKS (or any swapped-in OIDC provider — the validator just sees a
 * `JwksManager` and an `expectedIssuer`).
 *
 * On success the middleware attaches `req.user` (typed `UserContext`). On
 * failure it responds 401 with the standard §4.3 error body and emits a
 * `WWW-Authenticate: Bearer error="…"` challenge.
 *
 * Routes under `/auth/*` and `/.well-known/*` are skipped — they are the IdP
 * surface itself and cannot require authentication.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  AuthError,
  ERROR_CODES,
  buildErrorBody,
  wwwAuthenticateHeader,
  type ValidateUserTokenFn,
  type UserContext,
} from '@s2s/auth-library';

declare module 'express-serve-static-core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Request {
    user?: UserContext;
  }
}

export interface UserAuthMiddlewareOptions {
  validate: ValidateUserTokenFn;
  /** Paths that bypass the middleware. Default: /auth, /.well-known, /health, /metrics. */
  skipPaths?: string[];
}

const DEFAULT_SKIP = ['/auth', '/.well-known', '/health', '/metrics'];

function shouldSkip(reqPath: string, skips: string[]): boolean {
  for (const s of skips) {
    if (reqPath === s || reqPath.startsWith(s + '/')) return true;
  }
  return false;
}

function send401(req: Request, res: Response, err: AuthError): void {
  const body = buildErrorBody({
    code: err.code,
    description: err.message,
    requestId: req.header('x-request-id') ?? 'unknown',
  });
  res.setHeader('WWW-Authenticate', wwwAuthenticateHeader(err.code));
  res.status(err.status).json(body);
}

export function createUserAuthMiddleware(opts: UserAuthMiddlewareOptions): RequestHandler {
  const skips = opts.skipPaths ?? DEFAULT_SKIP;
  return async function userAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (shouldSkip(req.path, skips)) {
      next();
      return;
    }
    const header = req.header('authorization');
    if (!header || !/^Bearer\s+/i.test(header)) {
      send401(
        req,
        res,
        new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'missing bearer token'),
      );
      return;
    }
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      send401(
        req,
        res,
        new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'empty bearer token'),
      );
      return;
    }
    try {
      const user = await opts.validate({ token });
      req.user = user;
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        send401(req, res, err);
        return;
      }
      send401(
        req,
        res,
        new AuthError(401, ERROR_CODES.INVALID_TOKEN, (err as Error).message ?? 'token validation failed'),
      );
    }
  };
}
