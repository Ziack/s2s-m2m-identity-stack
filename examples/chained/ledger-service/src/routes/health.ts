import { Router } from 'express';
import { pingRedis, jwksLastRefreshAt } from '@s2s/auth-library';
import type { LedgerServiceConfig } from '../config.js';

const JWKS_MAX_AGE_MS = 26 * 60 * 60 * 1000;

export function healthRouter(_config: LedgerServiceConfig): Router {
  const router = Router();
  router.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  router.get('/health/auth', async (_req, res) => {
    let redisStatus: 'up' | 'down' = 'up';
    try { await pingRedis(); } catch { redisStatus = 'down'; }
    const lastRefresh = jwksLastRefreshAt() ?? 0;
    const jwksAgeMs = Date.now() - lastRefresh;
    const jwksStatus: 'fresh' | 'stale' = jwksAgeMs > JWKS_MAX_AGE_MS ? 'stale' : 'fresh';
    const ok = redisStatus === 'up' && jwksStatus === 'fresh';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      redis: redisStatus,
      jwks: jwksStatus,
      jwksAgeMs,
    });
  });
  return router;
}
