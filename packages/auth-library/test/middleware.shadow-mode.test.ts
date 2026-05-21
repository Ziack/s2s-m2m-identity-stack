import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBrokerAuthMiddleware, type BrokerAuthMode } from '../src/index.js';

function buildApp(mode: BrokerAuthMode, deps: {
  validateToken?: ReturnType<typeof vi.fn>;
  verifyDPoP?: ReturnType<typeof vi.fn>;
  authorize?: ReturnType<typeof vi.fn>;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}) {
  const app = express();
  const mw = createBrokerAuthMiddleware({
    expectedAudience: 'lending',
    resourcePrefix: 'lending',
    validateToken: deps.validateToken ?? vi.fn().mockResolvedValue({ sub: 's', scope: ['lending/read'], actor_chain: ['svc-a'] }),
    verifyDPoP: deps.verifyDPoP ?? vi.fn().mockResolvedValue({ jkt: 'tp' }),
    authorize: deps.authorize ?? vi.fn().mockResolvedValue({ decision: 'ALLOW', reasons: [] }),
    requireDPoP: false,
    mode,
    logger: deps.logger,
  });
  app.use(mw);
  app.get('/x', (req, res) => { res.json({ ok: true, auth: req.auth ?? null }); });
  return app;
}

describe('createBrokerAuthMiddleware enforce mode (default)', () => {
  it('rejects on missing token', async () => {
    const app = buildApp('enforce', {});
    const r = await request(app).get('/x');
    expect(r.status).toBe(401);
  });

  it('allows on valid token + ALLOW decision', async () => {
    const app = buildApp('enforce', {});
    const r = await request(app).get('/x').set('authorization', 'Bearer t');
    expect(r.status).toBe(200);
    expect(r.body.auth.decision).toBe('ALLOW');
  });

  it('denies on DENY decision', async () => {
    const app = buildApp('enforce', { authorize: vi.fn().mockResolvedValue({ decision: 'DENY', reasons: ['nope'] }) });
    const r = await request(app).get('/x').set('authorization', 'Bearer t');
    expect(r.status).toBe(403);
  });
});

describe('createBrokerAuthMiddleware log-only mode', () => {
  it('valid token: populates req.auth, logs decision, calls next (200)', async () => {
    const info = vi.fn();
    const app = buildApp('log-only', { logger: { info, warn: vi.fn() } });
    const r = await request(app).get('/x').set('authorization', 'Bearer t');
    expect(r.status).toBe(200);
    expect(r.body.auth.sub).toBe('s');
    expect(info).toHaveBeenCalled();
    const call = info.mock.calls.find((c) => String(c[1] ?? c[0]).includes('shadow_mode'));
    expect(call).toBeDefined();
  });

  it('would-be-DENY: still calls next (200), logs would-be decision', async () => {
    const info = vi.fn();
    const app = buildApp('log-only', {
      authorize: vi.fn().mockResolvedValue({ decision: 'DENY', reasons: ['policy-block'] }),
      logger: { info, warn: vi.fn() },
    });
    const r = await request(app).get('/x').set('authorization', 'Bearer t');
    expect(r.status).toBe(200);
    expect(info).toHaveBeenCalled();
  });

  it('invalid token: no req.auth, logs invalid, calls next (does NOT reject)', async () => {
    const warn = vi.fn();
    const app = buildApp('log-only', {
      validateToken: vi.fn().mockRejectedValue(new Error('bad sig')),
      logger: { info: vi.fn(), warn },
    });
    const r = await request(app).get('/x').set('authorization', 'Bearer bad');
    expect(r.status).toBe(200);
    expect(r.body.auth).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('missing Authorization: still calls next (200), no req.auth', async () => {
    const app = buildApp('log-only', { logger: { info: vi.fn(), warn: vi.fn() } });
    const r = await request(app).get('/x');
    expect(r.status).toBe(200);
    expect(r.body.auth).toBeNull();
  });
});
