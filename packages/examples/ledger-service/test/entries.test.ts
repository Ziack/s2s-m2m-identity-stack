import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { entriesRouter } from '../src/routes/entries.js';

const middleware = vi.fn((req: any, res: any, next: any) => {
  // Default to allow with dpop_confirmed; individual tests can override.
  if ((middleware as any).__deny) {
    res.status(403).json({ error: 'authorization_denied', reason: 'dpop_not_confirmed' });
    return;
  }
  req.auth = {
    sub: 'ServicePrincipal::receiving-service-outbound',
    principal: 'ServicePrincipal::receiving-service-outbound',
    action: 'POST_ledger_entry',
    scopes: ['ledger/write'],
    decision: 'ALLOW',
  };
  next();
});

vi.mock('@s2s/auth-library', () => ({
  createAuthMiddleware: () => middleware,
  createValidateToken: () => () => Promise.resolve({}),
  createVerifyDPoP: () => () => Promise.resolve({}),
  createAuthorize: () => () => Promise.resolve({}),
  createJwksManager: () => ({ getKeys: async () => [] }),
  createCedarLocal: () => ({ evaluate: () => ({ decision: 'ALLOW', reasons: [], evaluationTimeMs: 0, mode: 'local' }) }),
  createRedisNonceStore: () => ({ issue: async () => undefined, consume: async () => true }),
  getRedisClient: () => ({}),
}));

vi.mock('@aws-sdk/client-verifiedpermissions', () => ({
  VerifiedPermissionsClient: class { send = async () => ({ decision: 'ALLOW', determiningPolicies: [] }); },
  IsAuthorizedWithTokenCommand: class { constructor(public input: unknown) {} },
}));

const cfg = {
  port: 3000,
  expectedAudience: 'ledger',
  expectedIssuer: 'https://issuer',
  jwksUri: 'https://issuer/.well-known/jwks.json',
  jwksRefreshHours: 1,
  nonceTtlSeconds: 120,
  policyStoreId: 'ps-ledger',
  resourcePrefix: 'ledger',
  redisEndpoint: 'r',
  awsRegion: 'us-east-1',
  logLevel: 'silent',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', entriesRouter(cfg));
  return app;
}

describe('/api/ledger/entries', () => {
  it('POST returns 201 with { entryId, status } when auth ALLOW', async () => {
    (middleware as any).__deny = false;
    const res = await request(buildApp())
      .post('/api/ledger/entries')
      .send({ amount: 5000, reference: 'L-deadbeef' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      entryId: expect.stringMatching(/^E-/),
      status: 'posted',
    });
  });

  it('GET returns 200 with array', async () => {
    (middleware as any).__deny = false;
    const res = await request(buildApp()).get('/api/ledger/entries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('DENIES POST when middleware rejects (dpop_confirmed=false)', async () => {
    (middleware as any).__deny = true;
    const res = await request(buildApp())
      .post('/api/ledger/entries')
      .send({ amount: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('authorization_denied');
    (middleware as any).__deny = false;
  });

  it('routes pass through createAuthMiddleware', async () => {
    middleware.mockClear();
    await request(buildApp()).get('/api/ledger/entries');
    expect(middleware).toHaveBeenCalled();
  });
});
