import { Router } from 'express';
import type { SigningKeyLoader } from '../lib/signingKeyLoader.js';
import type { RedisLike } from '../lib/replayStore.js';

export interface HealthDeps {
  signingKey: SigningKeyLoader;
  redis?: RedisLike & { ping?: () => Promise<string> };
}

export function healthRouter(deps: HealthDeps): Router {
  const router = Router();
  router.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  router.get('/health/auth', async (_req, res) => {
    let signingKeyStatus: 'ok' | 'down' = 'ok';
    let kid: string | null = null;
    try {
      const k = await deps.signingKey.get();
      kid = k.kid;
    } catch {
      signingKeyStatus = 'down';
    }
    let redisStatus: 'up' | 'down' | 'unknown' = 'unknown';
    if (deps.redis && typeof deps.redis.ping === 'function') {
      try {
        const reply = await deps.redis.ping();
        redisStatus = reply === 'PONG' ? 'up' : 'down';
      } catch {
        redisStatus = 'down';
      }
    }
    const ok = signingKeyStatus === 'ok' && redisStatus !== 'down';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      signing_key: signingKeyStatus,
      kid,
      redis: redisStatus,
    });
  });
  return router;
}
