import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { loansRouter } from '../src/routes/loans.js';

// Simulate verifyDPoP behavior: throw a NonceRequiredError if nonce missing, NonceReuseError if reused.
class NonceRequiredError extends Error { code = 'use_dpop_nonce' as const; }
class NonceReuseError extends Error { code = 'dpop_nonce_reuse' as const; }

const verifyDPoPMock = vi.fn();
const generateDPoPNonceMock = vi.fn(() => 'fresh-nonce-abc');

// Replace the broker-aware middleware with a stub that imitates the SDK's
// nonce-challenge contract on top of the verifyDPoPMock. This test covers
// the routing surface (correct status codes / headers reach the client),
// not the real SDK nonce store.
vi.mock('../src/lib/brokerAuthMiddleware.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/brokerAuthMiddleware.js')>(
    '../src/lib/brokerAuthMiddleware.js',
  );
  return {
    ...actual,
    buildBrokerAuthMiddleware: () => async (req: any, res: any, next: any) => {
      try {
        await verifyDPoPMock(req);
        req.auth = {
          sub: 'user-alice',
          scopes: ['receiving/write'],
          decision: 'ALLOW',
          reasons: [],
          user: { sub: 'user-alice', roles: [], groups: [], claims: {}, issuer: 'http://broker' },
          actor_chain: { sub: 'calling-service' },
          token: 'tok',
        };
        next();
      } catch (err: any) {
        if (err.code === 'use_dpop_nonce') {
          res.setHeader('DPoP-Nonce', generateDPoPNonceMock());
          res.status(401).json({ error: 'use_dpop_nonce', error_description: 'nonce required', request_id: 'r', timestamp: new Date().toISOString() });
          return;
        }
        if (err.code === 'dpop_nonce_reuse') {
          res.setHeader('WWW-Authenticate', 'DPoP');
          res.status(401).json({ error: 'dpop_nonce_reuse', error_description: 'nonce consumed', request_id: 'r', timestamp: new Date().toISOString() });
          return;
        }
        next(err);
      }
    },
  };
});

const cfg = {
  port: 3000, expectedAudience: 'lending', expectedIssuer: 'https://issuer',
  jwksUri: 'https://issuer/.well-known/jwks.json', jwksRefreshHours: 1, nonceTtlSeconds: 120,
  policyStoreId: 'ps', resourcePrefix: 'lending',
  queueUrl: '', queueArn: '', redisEndpoint: 'r', awsRegion: 'us-east-1', logLevel: 'silent',
  ledgerServiceUrl: '', ledgerOutboundClientId: '', ledgerOutboundSecretArn: '',
  ledgerOutboundEnabled: false, cognitoDomain: '',
  brokerJwksUri: 'http://broker/jwks', brokerIssuer: 'http://broker',
  brokerAudience: 'receiving', brokerTokenEndpoint: 'http://broker/oauth2/token',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', loansRouter(cfg));
  return app;
}

describe('DPoP nonce challenge', () => {
  beforeEach(() => { verifyDPoPMock.mockReset(); generateDPoPNonceMock.mockClear(); });

  it('request without nonce -> 401 with DPoP-Nonce header and use_dpop_nonce body', async () => {
    verifyDPoPMock.mockRejectedValue(new NonceRequiredError('nonce required'));
    const res = await request(buildApp()).post('/api/loans').send({ amount: 1, applicantId: 'A' });
    expect(res.status).toBe(401);
    expect(res.headers['dpop-nonce']).toBe('fresh-nonce-abc');
    expect(res.body.error).toBe('use_dpop_nonce');
  });

  it('request with valid echoed nonce -> 201', async () => {
    verifyDPoPMock.mockResolvedValue(undefined);
    const res = await request(buildApp())
      .post('/api/loans')
      .set('dpop', 'proof-with-nonce')
      .send({ amount: 1, applicantId: 'A' });
    expect(res.status).toBe(201);
  });

  it('request reusing a consumed nonce -> 401 dpop_nonce_reuse', async () => {
    verifyDPoPMock.mockRejectedValue(new NonceReuseError('nonce already consumed'));
    const res = await request(buildApp())
      .post('/api/loans')
      .set('dpop', 'proof-with-stale-nonce')
      .send({ amount: 1, applicantId: 'A' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('dpop_nonce_reuse');
    expect(res.headers['www-authenticate']).toBe('DPoP');
  });
});
