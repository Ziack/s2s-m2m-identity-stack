import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { healthRouter } from '../src/routes/health.js';

const redisPingMock = vi.fn();
const jwksFreshMock = vi.fn();

vi.mock('@s2s/auth-library', () => ({
  pingRedis: () => redisPingMock(),
  jwksLastRefreshAt: () => jwksFreshMock(),
}));

const cfg = {
  port: 3000, expectedAudience: 'lending', expectedIssuer: 'https://issuer',
  jwksUri: 'https://issuer/.well-known/jwks.json', jwksRefreshHours: 1, nonceTtlSeconds: 120,
  policyStoreId: 'ps', resourcePrefix: 'lending',
  queueUrl: '', queueArn: '', redisEndpoint: 'r', awsRegion: 'us-east-1', logLevel: 'silent',
};

function buildApp() { return express().use(healthRouter(cfg)); }

describe('health endpoints', () => {
  it('GET /health is a liveness probe (always 200 if process alive)', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health/auth returns 200 when Redis up and Cognito JWKS cache fresh (<24h)', async () => {
    redisPingMock.mockResolvedValue('PONG');
    jwksFreshMock.mockReturnValue(Date.now() - 60_000);
    const res = await request(buildApp()).get('/health/auth');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', redis: 'up', jwksAgeMs: expect.any(Number) });
  });

  it('GET /health/auth returns 503 when Redis down', async () => {
    redisPingMock.mockRejectedValue(new Error('ECONNREFUSED'));
    jwksFreshMock.mockReturnValue(Date.now());
    const res = await request(buildApp()).get('/health/auth');
    expect(res.status).toBe(503);
    expect(res.body.redis).toBe('down');
  });

  it('GET /health/auth returns 503 when Cognito JWKS cache stale (>26h)', async () => {
    redisPingMock.mockResolvedValue('PONG');
    jwksFreshMock.mockReturnValue(Date.now() - 27 * 60 * 60 * 1000);
    const res = await request(buildApp()).get('/health/auth');
    expect(res.status).toBe(503);
    expect(res.body.jwks).toBe('stale');
  });
});
