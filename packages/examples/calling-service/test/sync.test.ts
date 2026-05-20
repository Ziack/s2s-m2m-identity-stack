import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { syncRouter } from '../src/routes/sync.js';

vi.mock('../src/lib/authClient.js', () => ({
  acquireToken: vi.fn().mockResolvedValue({
    accessToken: 'fake-token',
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    scopes: ['lending/read'],
    tokenSource: 'cognito',
  }),
  signDPoP: vi.fn().mockResolvedValue({ proof: 'fake-dpop-proof', jti: 'jti-1' }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const cfg = {
  port: 3000,
  clientId: 'lending-client',
  targetBaseUrl: 'https://receiver.example.com',
  targetAudience: 'lending',
  scopes: ['lending/read'],
  queueUrl: 'https://sqs/queue',
  queueArn: 'arn:aws:sqs:us-east-1:1:q',
  awsRegion: 'us-east-1',
  logLevel: 'silent',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/demo', syncRouter(cfg));
  return app;
}

describe('POST /demo/sync', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('acquires token, signs DPoP, calls target, returns 200 with downstream body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ loanId: 'L-42' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));

    const res = await request(buildApp()).post('/demo/sync').send({ amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ loanId: 'L-42' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://receiver.example.com/api/loans',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'authorization': 'DPoP fake-token',
          'dpop': 'fake-dpop-proof',
          'content-type': 'application/json',
        }),
      }),
    );
  });

  it('propagates downstream 403 with body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'authorization_denied' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    }));
    const res = await request(buildApp()).post('/demo/sync').send({ amount: 1000 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('authorization_denied');
  });
});
