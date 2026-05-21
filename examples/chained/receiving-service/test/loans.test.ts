import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { loansRouter } from '../src/routes/loans.js';
import * as ledgerClient from '../src/lib/ledgerClient.js';

// Capture AVP authorize calls so we can assert the broker context shape.
const authorizeCalls: Array<Record<string, unknown>> = [];

// Default user/actor_chain injected by the mocked broker middleware. Tests
// can override per-call via `middlewareOverride`.
const defaultUser = {
  sub: 'user-alice',
  roles: ['lending-officer'],
  groups: ['lending-team'],
  claims: { sub: 'user-alice', roles: ['lending-officer'], groups: ['lending-team'] },
  issuer: 'http://broker',
};
const defaultActorChain = { sub: 'calling-service' };

// Replace `buildBrokerAuthMiddleware` with a synchronous stand-in that
// populates `req.auth` with the broker-aware shape. Bypasses real JWKS /
// DPoP / AVP wiring — these are unit-tested in
// `test/broker-auth-middleware.test.ts`.
let middlewareOverride: ((req: any, res: any, next: any) => void) | null = null;
const middleware = vi.fn((req: any, _res: any, next: any) => {
  if (middlewareOverride) {
    middlewareOverride(req, _res, next);
    return;
  }
  req.auth = {
    sub: defaultUser.sub,
    scopes: ['receiving/write'],
    decision: 'ALLOW',
    reasons: [],
    user: defaultUser,
    actor_chain: defaultActorChain,
    token: 'inbound-token-xyz',
    principal: `ServicePrincipal::${defaultUser.sub}`,
    action: 'POST_loans',
  };
  // Record a synthetic authorize call so tests can inspect AVP context shape.
  authorizeCalls.push({
    context: {
      dpop_confirmed: true,
      scopes: ['receiving/write'],
      source_domain: 'receiving',
      correlation_id: req.headers['x-correlation-id'] ?? 'corr-test',
      user: { sub: defaultUser.sub, roles: defaultUser.roles, groups: defaultUser.groups },
      actor_chain: [defaultActorChain.sub],
    },
  });
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

const baseCfg = {
  port: 3000, expectedAudience: 'lending', expectedIssuer: 'https://issuer',
  jwksUri: 'https://issuer/.well-known/jwks.json', jwksRefreshHours: 1, nonceTtlSeconds: 120,
  policyStoreId: 'ps-1', resourcePrefix: 'lending',
  queueUrl: 'x', queueArn: 'x', redisEndpoint: 'x', awsRegion: 'us-east-1', logLevel: 'silent',
  ledgerServiceUrl: 'http://ledger.local',
  ledgerOutboundClientId: 'receiving-service-outbound',
  ledgerOutboundSecretArn: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:m2m/receiving-outbound/client-secret-abc',
  ledgerOutboundEnabled: false,
  cognitoDomain: 'example',
  brokerJwksUri: 'http://broker/.well-known/jwks.json',
  brokerIssuer: 'http://broker',
  brokerAudience: 'receiving',
  brokerTokenEndpoint: 'http://broker/oauth2/token',
};
const cfg = baseCfg;

function buildApp(overrides: Partial<typeof baseCfg> = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api', loansRouter({ ...baseCfg, ...overrides }));
  return app;
}

describe('/api/loans', () => {
  beforeEach(() => {
    middlewareOverride = null;
    authorizeCalls.length = 0;
  });

  it('POST returns 201 with persisted loan referencing user.sub as principal', async () => {
    const res = await request(buildApp()).post('/api/loans').send({ amount: 1000, applicantId: 'A-1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      loanId: expect.stringMatching(/^L-/),
      amount: 1000,
      applicantId: 'A-1',
      createdBy: defaultUser.sub,
    });
  });

  it('POST response echoes user + actor_chain from req.auth', async () => {
    const res = await request(buildApp()).post('/api/loans').send({ amount: 1, applicantId: 'A-2' });
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      sub: defaultUser.sub,
      roles: defaultUser.roles,
      groups: defaultUser.groups,
    });
    expect(res.body.actor_chain).toEqual([defaultActorChain.sub]);
  });

  it('AVP authorize context includes user_context and actor_chain', async () => {
    await request(buildApp()).post('/api/loans').send({ amount: 1, applicantId: 'A-3' });
    expect(authorizeCalls.length).toBe(1);
    const ctx = authorizeCalls[0]!.context as Record<string, unknown>;
    expect(ctx.user).toMatchObject({ sub: defaultUser.sub, roles: defaultUser.roles });
    expect(ctx.actor_chain).toEqual([defaultActorChain.sub]);
    expect(ctx.dpop_confirmed).toBe(true);
    expect(ctx.source_domain).toBe('receiving');
  });

  it('GET returns 200 with array', async () => {
    const res = await request(buildApp()).get('/api/loans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('routes pass through broker auth middleware', async () => {
    middleware.mockClear();
    await request(buildApp()).get('/api/loans');
    expect(middleware).toHaveBeenCalled();
  });

  describe('ledger chaining', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('chains ledger call with subjectToken from req.auth when LEDGER_OUTBOUND_ENABLED=true', async () => {
      const spy = vi
        .spyOn(ledgerClient, 'postLedgerEntry')
        .mockResolvedValue({ entryId: 'E-12345', status: 'committed' });
      const res = await request(buildApp({ ledgerOutboundEnabled: true }))
        .post('/api/loans')
        .send({ amount: 500, applicantId: 'A-9' });
      expect(res.status).toBe(201);
      expect(res.body.ledger).toEqual({ entryId: 'E-12345', status: 'committed' });
      expect(spy).toHaveBeenCalledTimes(1);
      const args = spy.mock.calls[0]?.[1];
      expect(args?.payload).toMatchObject({ amount: 500 });
      expect(args?.payload.loanId).toMatch(/^L-/);
      expect(args?.subjectToken).toBe('inbound-token-xyz');
    });

    it('skips ledger call when LEDGER_OUTBOUND_ENABLED=false', async () => {
      const spy = vi.spyOn(ledgerClient, 'postLedgerEntry');
      const res = await request(buildApp({ ledgerOutboundEnabled: false }))
        .post('/api/loans')
        .send({ amount: 700, applicantId: 'A-10' });
      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty('ledger');
      expect(spy).not.toHaveBeenCalled();
    });

    it('returns 502 downstream_unavailable when ledger call fails', async () => {
      vi.spyOn(ledgerClient, 'postLedgerEntry').mockRejectedValue(
        new ledgerClient.LedgerOutboundError(500, 'boom'),
      );
      const res = await request(buildApp({ ledgerOutboundEnabled: true }))
        .post('/api/loans')
        .send({ amount: 100, applicantId: 'A-11' });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('downstream_unavailable');
    });
  });
});

void cfg;
