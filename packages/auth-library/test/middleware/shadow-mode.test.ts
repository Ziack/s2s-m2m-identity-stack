/**
 * Behavioural tests for the shadow-mode pattern referenced by
 * `docs/onboarding-existing-app.md` Phase 2b.
 *
 * Verifies:
 *  1. `mode: 'log-only'` calls `next()` regardless of a DENY decision and never
 *     short-circuits the response.
 *  2. The metrics counter the migration guide names — implemented in the SDK
 *     as `metrics.m2mShadowModeDecisionsTotal` — increments per decision.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBrokerAuthMiddleware } from '../../src/index.js';

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function buildCounter() {
  const inc = vi.fn();
  return { inc, m2mShadowModeDecisionsTotal: { inc } };
}

function buildApp(opts: {
  decision: 'ALLOW' | 'DENY';
  logger: ReturnType<typeof buildLogger>;
  counter: ReturnType<typeof buildCounter>;
}) {
  const app = express();
  const mw = createBrokerAuthMiddleware({
    expectedAudience: 'orders',
    resourcePrefix: 'orders',
    validateToken: vi
      .fn()
      .mockResolvedValue({ sub: 'alice', scope: ['orders/read'], actor_chain: ['svc-a'] }),
    verifyDPoP: vi.fn().mockResolvedValue({ jkt: 'tp' }),
    authorize: vi.fn().mockResolvedValue({ decision: opts.decision, reasons: ['policy-x'] }),
    requireDPoP: false,
    mode: 'log-only',
    logger: opts.logger,
    metrics: { m2mShadowModeDecisionsTotal: opts.counter.m2mShadowModeDecisionsTotal },
  });
  app.use(mw);
  app.get('/x', (req, res) => res.json({ ok: true, auth: req.auth ?? null }));
  return app;
}

describe('shadow-mode behaviour (migration guide Phase 2b)', () => {
  it('logs decision and calls next() regardless of deny', async () => {
    const logger = buildLogger();
    const counter = buildCounter();
    const app = buildApp({ decision: 'DENY', logger, counter });
    const res = await request(app).get('/x').set('authorization', 'Bearer tok');
    // next() must run — response is 200 from the downstream handler, not 403.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // pino-shaped log emitted with shadow_mode + decision.
    const infoCalls = logger.info.mock.calls;
    expect(infoCalls.length).toBeGreaterThan(0);
    const [firstObj] = infoCalls[0] as [Record<string, unknown>];
    expect(firstObj.shadow_mode).toBe(true);
    expect(firstObj.decision).toBe('DENY');
  });

  it("increments m2mShadowModeDecisionsTotal{decision,result} counter for allow + deny", async () => {
    const logger = buildLogger();
    const counter = buildCounter();

    // First — DENY
    const denyApp = buildApp({ decision: 'DENY', logger, counter });
    await request(denyApp).get('/x').set('authorization', 'Bearer tok');
    expect(counter.inc).toHaveBeenCalledWith({ decision: 'DENY', result: 'would_deny' });

    // Then — ALLOW
    const allowApp = buildApp({ decision: 'ALLOW', logger, counter });
    await request(allowApp).get('/x').set('authorization', 'Bearer tok');
    expect(counter.inc).toHaveBeenCalledWith({ decision: 'ALLOW', result: 'would_allow' });
  });
});
