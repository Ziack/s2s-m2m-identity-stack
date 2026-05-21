import { Router } from 'express';
import type { SigningKeyLoader } from '../lib/signingKeyLoader.js';

export function jwksRouter(loader: SigningKeyLoader): Router {
  const router = Router();
  router.get('/.well-known/jwks.json', async (_req, res) => {
    try {
      const key = await loader.get();
      res.setHeader('cache-control', 'public, max-age=300');
      res.status(200).json({ keys: [key.publicJwk] });
    } catch (err) {
      res.status(503).json({ error: 'signing_key_unavailable', detail: (err as Error).message });
    }
  });
  return router;
}
