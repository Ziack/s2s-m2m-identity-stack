import { Router } from 'express';
import { getPublicJwk } from '@s2s/auth-library';

export function jwksRouter(): Router {
  const router = Router();
  router.get('/.well-known/jwks.json', (_req, res) => {
    const jwk = getPublicJwk();
    res.setHeader('cache-control', 'public, max-age=300');
    res.json({ keys: [jwk] });
  });
  return router;
}
