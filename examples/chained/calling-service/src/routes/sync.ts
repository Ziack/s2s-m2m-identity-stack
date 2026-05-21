import { Router, type Request, type Response as ExpressResponse } from 'express';
import { signDPoP } from '../lib/authClient.js';
import { getExchangeToken } from '../lib/exchangeClient.js';
import type { CallingServiceConfig } from '../config.js';

/**
 * POST /demo/sync — user-authenticated, on-behalf-of flow.
 *
 *   1. Caller arrives with `Authorization: Bearer <user-token>` (validated
 *      upstream by `userAuthMiddleware`, which populates `req.user`).
 *   2. We exchange that user token at the broker (RFC 8693) for a
 *      downstream-audience access token bound to this service as actor.
 *   3. We sign a DPoP proof with the calling-service's per-process key and
 *      POST to receiving-service.
 *   4. On 401 + `use_dpop_nonce` we retry once with the echoed nonce.
 *   5. We echo the authenticated identity back in the response body so the
 *      caller can confirm propagation.
 */
export function syncRouter(config: CallingServiceConfig): Router {
  const router = Router();

  router.post('/sync', async (req: Request, res: ExpressResponse) => {
    const receivingBase = config.receivingServiceUrl || config.targetBaseUrl;
    const htu = `${receivingBase}/api/loans`;
    const user = req.user;
    if (!user) {
      // Defence in depth — middleware should have already short-circuited.
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'missing user context',
        request_id: req.header('x-request-id') ?? 'unknown',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const authHeader = req.header('authorization') ?? '';
    const subjectToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const userSub = user.sub;

    try {
      const exchange = getExchangeToken();
      const exchanged = await exchange({
        subjectToken,
        audience: config.targetAudience,
        scope: config.scopes,
      });

      async function callOnce(nonce?: string): Promise<Response> {
        const dpopOpts: { accessToken: string; htm: string; htu: string; nonce?: string } = {
          accessToken: exchanged.accessToken,
          htm: 'POST',
          htu,
        };
        if (nonce) dpopOpts.nonce = nonce;
        const dpop = await signDPoP(dpopOpts);
        return fetch(htu, {
          method: 'POST',
          headers: {
            'authorization': `DPoP ${exchanged.accessToken}`,
            'dpop': dpop.proof,
            'content-type': 'application/json',
            'x-correlation-id': req.header('x-correlation-id') ?? req.header('x-request-id') ?? '',
            'x-user-sub': userSub,
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
      let downstreamBody: unknown;
      const ct = upstream.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        try {
          downstreamBody = JSON.parse(text);
        } catch {
          downstreamBody = text;
        }
      } else {
        downstreamBody = text;
      }
      res.status(upstream.status).json({
        downstream: downstreamBody,
        user: { sub: user.sub, roles: user.roles },
      });
    } catch (err) {
      (req as Request & { log?: { error: (...args: unknown[]) => void } }).log?.error(
        { err },
        'sync flow failed',
      );
      const message = err instanceof Error ? err.message : 'unknown';
      // Token-exchange or fetch failures bubble up as downstream-unavailable.
      res.status(502).json({
        error: 'downstream_unavailable',
        error_description: message,
        request_id: req.header('x-request-id') ?? 'unknown',
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
