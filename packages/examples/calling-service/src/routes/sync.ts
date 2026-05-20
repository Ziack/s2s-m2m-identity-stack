import { Router, type Request, type Response as ExpressResponse } from 'express';
import { acquireToken, signDPoP } from '../lib/authClient.js';
import type { CallingServiceConfig } from '../config.js';

export function syncRouter(config: CallingServiceConfig): Router {
  const router = Router();
  router.post('/sync', async (req: Request, res: ExpressResponse) => {
    const htu = `${config.targetBaseUrl}/api/loans`;
    try {
      const token = await acquireToken(config.clientId, config.scopes);

      async function callOnce(nonce?: string): Promise<Response> {
        const dpopOpts: { accessToken: string; htm: string; htu: string; nonce?: string } = {
          accessToken: token.accessToken,
          htm: 'POST',
          htu,
        };
        if (nonce) dpopOpts.nonce = nonce;
        const dpop = await signDPoP(dpopOpts);
        return fetch(htu, {
          method: 'POST',
          headers: {
            'authorization': `DPoP ${token.accessToken}`,
            'dpop': dpop.proof,
            'content-type': 'application/json',
          },
          body: JSON.stringify(req.body),
        });
      }

      let upstream = await callOnce();
      if (upstream.status === 401) {
        const nonce = upstream.headers.get('dpop-nonce');
        const bodyClone = await upstream.clone().json().catch(() => ({})) as { error?: string };
        if (nonce && bodyClone?.error === 'use_dpop_nonce') {
          upstream = await callOnce(nonce);
        }
      }

      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('content-type', ct);
      res.send(text);
    } catch (err) {
      (req as Request & { log?: { error: (...args: unknown[]) => void } }).log?.error({ err }, 'sync flow failed');
      res.status(502).json({
        error: 'upstream_error',
        error_description: err instanceof Error ? err.message : 'unknown',
        request_id: req.header('x-request-id') ?? 'unknown',
        timestamp: new Date().toISOString(),
      });
    }
  });
  return router;
}
