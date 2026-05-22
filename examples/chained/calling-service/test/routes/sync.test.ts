import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../src/lib/authClient.js', () => ({
  signDPoP: vi.fn().mockResolvedValue({ proof: 'fake-dpop-proof', jti: 'jti-1' }),
}));

const exchangeMock = vi.fn();
vi.mock('../../src/lib/exchangeClient.js', () => ({
  getExchangeToken: () => exchangeMock,
  setExchangeTokenForTest: vi.fn(),
  initExchangeClient: vi.fn(),
}));

import { syncRouter, toHttpsBaseUrl } from '../../src/routes/sync.js';
import { __setLatticeFetchForTest } from '../../src/lib/latticeFetch.js';

describe('toHttpsBaseUrl', () => {
  it('upgrades http:// to https:// so the signed htu matches the receiver scheme', () => {
    expect(toHttpsBaseUrl('http://receiver.internal')).toBe('https://receiver.internal');
  });
  it('passes https:// through unchanged', () => {
    expect(toHttpsBaseUrl('https://receiver.internal')).toBe('https://receiver.internal');
  });
  it('defaults a schemeless host to https://', () => {
    expect(toHttpsBaseUrl('receiver.internal')).toBe('https://receiver.internal');
  });
  it('passes empty string through unchanged', () => {
    expect(toHttpsBaseUrl('')).toBe('');
  });
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const cfg = {
  port: 3000,
  clientId: 'lending-client',
  cognitoDomain: 'x',
  clientSecretArn: 'arn:secret',
  redisEndpoint: 'redis://x',
  targetBaseUrl: 'https://receiver.example.com',
  targetAudience: 'receiving',
  scopes: ['lending/write'],
  queueUrl: 'https://sqs/queue',
  queueArn: 'arn:aws:sqs:us-east-1:1:q',
  awsRegion: 'us-east-1',
  logLevel: 'silent',
  userIssuerUrl: 'http://test/auth',
  userIssuerAudience: 'calling-service',
  userIssuerDevKeyPem: 'x',
  brokerTokenEndpoint: 'http://broker/oauth2/token',
  brokerActorClientId: 'calling-service',
  brokerActorSecretArn: 'arn:broker-secret',
  receivingServiceUrl: 'https://receiver.example.com',
  nodeEnv: 'test',
};

function injectUser(user: { sub: string; roles: string[]; groups: string[]; claims: Record<string, unknown>; issuer: string } | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (user) req.user = user;
    next();
  };
}

function buildApp(user: Parameters<typeof injectUser>[0] = { sub: 'user-alice', roles: ['loan-officer'], groups: ['retail-banking'], claims: {}, issuer: 'http://test/auth' }) {
  const app = express();
  app.use(express.json());
  app.use(injectUser(user));
  app.use((req, _res, next) => {
    // Simulate the Authorization header surviving past middleware
    if (!req.header('authorization')) req.headers.authorization = 'Bearer fake-user-token';
    next();
  });
  app.use('/demo', syncRouter(cfg));
  return app;
}

beforeEach(() => {
  fetchMock.mockReset();
  exchangeMock.mockReset();
  delete process.env.USE_LATTICE;
  __setLatticeFetchForTest(null);
});

describe('POST /demo/sync (user-auth + token-exchange)', () => {
  it('exchanges user token, signs DPoP, calls receiving, returns body with user.sub', async () => {
    exchangeMock.mockResolvedValue({
      accessToken: 'exchanged-token',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      tokenType: 'DPoP',
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scopes: ['lending/write'],
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ loanId: 'L-42' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await request(buildApp()).post('/demo/sync').send({ amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.downstream).toEqual({ loanId: 'L-42' });
    expect(res.body.user).toEqual({ sub: 'user-alice', roles: ['loan-officer'] });

    expect(exchangeMock).toHaveBeenCalledWith(expect.objectContaining({
      subjectToken: 'fake-user-token',
      audience: 'receiving',
      scope: ['lending/write'],
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://receiver.example.com/api/loans',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'authorization': 'DPoP exchanged-token',
          'dpop': 'fake-dpop-proof',
          'x-user-sub': 'user-alice',
        }),
      }),
    );
  });

  it('returns 401 when user context is missing (defence in depth)', async () => {
    const app = express();
    app.use(express.json());
    app.use('/demo', syncRouter(cfg));
    const res = await request(app).post('/demo/sync').send({ amount: 1 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 502 downstream_unavailable when exchange fails', async () => {
    exchangeMock.mockRejectedValue(new Error('broker rejected exchange'));
    const res = await request(buildApp()).post('/demo/sync').send({ amount: 1 });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('downstream_unavailable');
    expect(res.body.error_description).toContain('broker rejected exchange');
  });

  it('Lattice mode: SigV4-signs to receiving Lattice DNS with token in X-DPoP-Token', async () => {
    process.env.USE_LATTICE = 'true';
    const latticeMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ loanId: 'L-lattice' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    __setLatticeFetchForTest(latticeMock);
    exchangeMock.mockResolvedValue({
      accessToken: 'exchanged-token',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      tokenType: 'DPoP',
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scopes: ['lending/write'],
    });

    const latticeCfg = { ...cfg, receivingLatticeDns: 'receiving-abc.vpc-lattice-svcs.us-east-1.on.aws' };
    const app = express();
    app.use(express.json());
    app.use(injectUser({ sub: 'user-alice', roles: ['loan-officer'], groups: [], claims: {}, issuer: 'http://test/auth' }));
    app.use((req, _res, next) => { req.headers.authorization = 'Bearer fake-user-token'; next(); });
    app.use('/demo', syncRouter(latticeCfg as unknown as Parameters<typeof syncRouter>[0]));

    const res = await request(app).post('/demo/sync').send({ amount: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.downstream).toEqual({ loanId: 'L-lattice' });
    // Global fetch must NOT be used in Lattice mode.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latticeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://receiving-abc.vpc-lattice-svcs.us-east-1.on.aws/api/loans',
        method: 'POST',
        headers: expect.objectContaining({
          'X-DPoP-Token': 'exchanged-token',
          'dpop': 'fake-dpop-proof',
        }),
      }),
    );
    // Access token must NOT be in Authorization (SigV4 owns it).
    const sentHeaders = latticeMock.mock.calls[0][0].headers as Record<string, string>;
    expect(sentHeaders['authorization']).toBeUndefined();
  });

  it('retries once on DPoP nonce challenge', async () => {
    exchangeMock.mockResolvedValue({
      accessToken: 'exchanged-token',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      tokenType: 'DPoP',
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scopes: [],
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
          status: 401,
          headers: { 'content-type': 'application/json', 'dpop-nonce': 'nonce-1' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ loanId: 'L-2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const res = await request(buildApp()).post('/demo/sync').send({ amount: 1 });
    expect(res.status).toBe(200);
    expect(res.body.downstream).toEqual({ loanId: 'L-2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
