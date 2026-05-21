/**
 * Local IdP HTTP surface. Exposes:
 *   POST /auth/login                          → mints a user JWT
 *   GET  /auth/.well-known/jwks.json          → publishes the user-issuer pubkey
 *   GET  /auth/.well-known/openid-configuration → minimal OIDC discovery
 *   GET  /auth/users  (dev-only)              → lists test usernames + roles
 *
 * The router is intentionally mounted at the path component of
 * `USER_ISSUER_URL` so that the JWKS URI advertised in discovery resolves
 * exactly to where this app serves it.
 */
import { Router, type Request, type Response } from 'express';
import { AuthError, ERROR_CODES, buildErrorBody } from '@s2s/auth-library';
import type { LocalIssuer } from '../auth/localIssuer.js';
import type { UserIssuerKeyLoader } from '../auth/userIssuerKeyLoader.js';
import { listTestUsers } from '../auth/testUsers.js';

export interface AuthRouterOptions {
  issuer: string;
  audience: string;
  localIssuer: LocalIssuer;
  keyLoader: UserIssuerKeyLoader;
  isProduction: boolean;
}

function sendAuthError(req: Request, res: Response, err: AuthError): void {
  const body = buildErrorBody({
    code: err.code,
    description: err.message,
    requestId: req.header('x-request-id') ?? 'unknown',
  });
  res.status(err.status).json(body);
}

export function authRouter(opts: AuthRouterOptions): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (typeof username !== 'string' || typeof password !== 'string') {
      sendAuthError(
        req,
        res,
        new AuthError(400, ERROR_CODES.INVALID_TOKEN, 'username and password are required'),
      );
      return;
    }
    try {
      const result = await opts.localIssuer.issueUserToken({ username, password });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        sendAuthError(req, res, err);
        return;
      }
      sendAuthError(
        req,
        res,
        new AuthError(500, ERROR_CODES.INVALID_TOKEN, (err as Error).message ?? 'login failed'),
      );
    }
  });

  router.get('/.well-known/jwks.json', async (_req: Request, res: Response) => {
    try {
      const key = await opts.keyLoader.get();
      res.setHeader('cache-control', 'public, max-age=300');
      res.status(200).json({ keys: [key.publicJwk] });
    } catch (err) {
      res.status(503).json({
        error: 'user_issuer_key_unavailable',
        detail: (err as Error).message,
      });
    }
  });

  router.get('/.well-known/openid-configuration', (_req: Request, res: Response) => {
    res.setHeader('cache-control', 'public, max-age=300');
    res.status(200).json({
      issuer: opts.issuer,
      jwks_uri: `${opts.issuer}/.well-known/jwks.json`,
      token_endpoint: `${opts.issuer}/login`,
      id_token_signing_alg_values_supported: ['RS256'],
      response_types_supported: ['token'],
      subject_types_supported: ['public'],
    });
  });

  router.get('/users', (_req: Request, res: Response) => {
    if (opts.isProduction) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(200).json({ users: listTestUsers() });
  });

  return router;
}
