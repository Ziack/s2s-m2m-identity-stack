import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { loansRouter } from '../src/routes/loans.js';

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

const cfg = {
  port: 3000, expectedAudience: 'lending', expectedIssuer: 'https://issuer',
  jwksUri: 'https://issuer/.well-known/jwks.json', jwksRefreshHours: 1, nonceTtlSeconds: 120,
  policyStoreId: 'ps-1', resourcePrefix: 'lending',
  queueUrl: 'x', queueArn: 'x', redisEndpoint: 'x', awsRegion: 'us-east-1', logLevel: 'silent',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', loansRouter(cfg));
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
});
