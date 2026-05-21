/**
 * Verifies the high-level BrokerAuthConfig form of createBrokerAuthMiddleware
 * actually wires the real createValidateToken / createVerifyDPoP / createAuthorize
 * internally (Plan 2 left this as a 401-throwing stub; Plan 3 completes it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SignJWT, generateKeyPair, exportJWK, calculateJwkThumbprint } from 'jose';
import {
  createBrokerAuthMiddleware,
  setRedisClientForTest,
  resetRedisClientForTest,
} from '../src/index.js';
import type { AvpClientLike } from '../src/authz/authorize.js';

// Minimal in-memory Redis stand-in covering the operations used by
// createRedisNonceStore + createVerifyDPoP.
function buildFakeRedis() {
  const store = new Map<string, string>();
  return {
    async set(key: string, val: string, _mode?: string, _ttl?: number, _nx?: string) {
      if (_nx === 'NX' && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    },
    async get(key: string) { return store.get(key) ?? null; },
    async del(key: string) { return store.delete(key) ? 1 : 0; },
    async exists(key: string) { return store.has(key) ? 1 : 0; },
    async ping() { return 'PONG'; },
  } as unknown as Parameters<typeof setRedisClientForTest>[0];
}

describe('createBrokerAuthMiddleware (BrokerAuthConfig high-level form)', () => {
  let kp: Awaited<ReturnType<typeof generateKeyPair>>;
  let jwk: Awaited<ReturnType<typeof exportJWK>>;
  let kid: string;
  let fetchImpl: ReturnType<typeof vi.fn>;
  let avpClient: AvpClientLike;

  beforeEach(async () => {
    kp = await generateKeyPair('RS256');
    jwk = await exportJWK(kp.publicKey);
    kid = await calculateJwkThumbprint(jwk);
    jwk.kid = kid;
    jwk.alg = 'RS256';

    fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [jwk] }),
    });

    avpClient = {
      isAuthorizedWithToken: vi.fn().mockResolvedValue({
        Decision: 'ALLOW',
        DeterminingPolicies: [{ PolicyId: 'policy-1' }],
      }),
    };

    setRedisClientForTest(buildFakeRedis() as never);
  });

  afterEach(() => {
    resetRedisClientForTest();
  });

  async function makeToken(claims: Record<string, unknown> = {}) {
    return new SignJWT({ scope: 'lending/read', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
      .setIssuer('https://broker.test')
      .setAudience('lending')
      .setSubject('svc-caller')
      .setExpirationTime('1h')
      .sign(kp.privateKey);
  }

  function buildApp() {
    const mw = createBrokerAuthMiddleware({
      brokerJwksUri: 'https://broker.test/.well-known/jwks.json',
      brokerIssuer: 'https://broker.test',
      brokerAudience: 'lending',
      policyStoreId: 'ps-1',
      resourcePrefix: 'lending',
      awsRegion: 'us-east-1',
      redisEndpoint: 'redis://fake:6379',
      requireDPoP: false,
      _fetchImpl: fetchImpl,
      _avpClient: avpClient,
    });
    const app = express();
    app.use(mw);
    app.get('/x', (req, res) => res.json({ ok: true, auth: req.auth ?? null }));
    return app;
  }

  it('validates a real token via createValidateToken + ALLOWs via injected AVP client', async () => {
    const token = await makeToken();
    const r = await request(buildApp()).get('/x').set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.auth?.decision).toBe('ALLOW');
    expect(avpClient.isAuthorizedWithToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalled();  // JWKS was fetched
  });

  it('rejects token with wrong issuer', async () => {
    const badIssToken = await new SignJWT({ scope: 'lending/read' })
      .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
      .setIssuer('https://wrong-issuer.test')
      .setAudience('lending')
      .setSubject('svc-caller')
      .setExpirationTime('1h')
      .sign(kp.privateKey);
    const r = await request(buildApp()).get('/x').set('authorization', `Bearer ${badIssToken}`);
    expect(r.status).toBe(401);
  });

  it('denies when AVP returns DENY', async () => {
    (avpClient.isAuthorizedWithToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      Decision: 'DENY',
      DeterminingPolicies: [{ PolicyId: 'forbid-1' }],
    });
    const token = await makeToken();
    const r = await request(buildApp()).get('/x').set('authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });

  it('rejects missing Authorization (real wiring, enforce mode by default)', async () => {
    const r = await request(buildApp()).get('/x');
    expect(r.status).toBe(401);
  });
});
