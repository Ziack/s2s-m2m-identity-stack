import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { loansRouter } from '../src/routes/loans.js';
import * as ledgerClient from '../src/lib/ledgerClient.js';

const middleware = vi.fn((req: any, _res: any, next: any) => {
  req.auth = { principal: 'ServicePrincipal::lending-client', action: 'POST_loan_application', scopes: ['lending/write'] };
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
};
const cfg = baseCfg;

function buildApp(overrides: Partial<typeof baseCfg> = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api', loansRouter({ ...baseCfg, ...overrides }));
  return app;
}

describe('/api/loans', () => {
  it('POST returns 201 with persisted loan referencing principal', async () => {
    const res = await request(buildApp()).post('/api/loans').send({ amount: 1000, applicantId: 'A-1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      loanId: expect.stringMatching(/^L-/),
      amount: 1000,
      applicantId: 'A-1',
      createdBy: 'ServicePrincipal::lending-client',
    });
  });

  it('GET returns 200 with array', async () => {
    const res = await request(buildApp()).get('/api/loans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('routes pass through createAuthMiddleware', async () => {
    middleware.mockClear();
    await request(buildApp()).get('/api/loans');
    expect(middleware).toHaveBeenCalled();
  });

  describe('ledger chaining', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('chains ledger call when LEDGER_OUTBOUND_ENABLED=true', async () => {
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
