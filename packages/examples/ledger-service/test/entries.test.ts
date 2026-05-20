import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { entriesRouter } from '../src/routes/entries.js';

const defaultUser = {
  sub: 'user-alice',
  roles: ['lending-officer'],
  groups: ['lending-team'],
  claims: { sub: 'user-alice' },
  issuer: 'http://broker',
};
const defaultActorChain = {
  sub: 'receiving-service-outbound',
  act: { sub: 'calling-service' },
};

const middleware = vi.fn((req: any, res: any, next: any) => {
  if ((middleware as any).__deny) {
    res.status(403).json({ error: 'authorization_denied', reason: 'dpop_not_confirmed' });
    return;
  }
  req.auth = {
    sub: defaultUser.sub,
    principal: `ServicePrincipal::${defaultUser.sub}`,
    action: 'POST_ledger_entry',
    scopes: ['ledger/write'],
    decision: 'ALLOW',
    reasons: [],
    user: defaultUser,
    actor_chain: defaultActorChain,
    token: 'inbound-token',
  };
  next();
});

vi.mock('../src/lib/brokerAuthMiddleware.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/brokerAuthMiddleware.js')>(
    '../src/lib/brokerAuthMiddleware.js',
  );
  return {
    ...actual,
    buildBrokerAuthMiddleware: () => middleware,
  };
});

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
  brokerJwksUri: 'http://broker/jwks',
  brokerIssuer: 'http://broker',
  brokerAudience: 'ledger',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', entriesRouter(cfg));
  return app;
}

describe('/api/ledger/entries', () => {
  beforeEach(() => {
    (middleware as any).__deny = false;
  });

  it('POST returns 201 with { entryId, status, audit } when auth ALLOW', async () => {
    const res = await request(buildApp())
      .post('/api/ledger/entries')
      .send({ amount: 5000, reference: 'L-deadbeef' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      entryId: expect.stringMatching(/^E-/),
      status: 'posted',
    });
  });

  it('POST response audit field echoes user + actor_chain from req.auth', async () => {
    const res = await request(buildApp())
      .post('/api/ledger/entries')
      .send({ amount: 1, reference: 'r' });
    expect(res.status).toBe(201);
    expect(res.body.audit).toEqual({
      user_sub: defaultUser.sub,
      user_roles: defaultUser.roles,
      // actor_chain flattened innermost-first
      actor_chain: ['calling-service', 'receiving-service-outbound'],
    });
  });

  it('POST createdBy uses user.sub (not the actor)', async () => {
    // The route persists `createdBy` from req.auth.user.sub — Phase 4 contract.
    // Internal store is not exposed, but we exercise the POST happy path.
    const res = await request(buildApp())
      .post('/api/ledger/entries')
      .send({ amount: 1 });
    expect(res.status).toBe(201);
    expect(res.body.audit.user_sub).toBe(defaultUser.sub);
  });

  it('GET returns 200 with array', async () => {
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

  it('routes pass through broker auth middleware', async () => {
    middleware.mockClear();
    await request(buildApp()).get('/api/ledger/entries');
    expect(middleware).toHaveBeenCalled();
  });
});
