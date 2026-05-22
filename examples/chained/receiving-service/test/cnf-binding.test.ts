/**
 * Full-chain RFC 9449 §6 sender-constraint (cnf.jkt) tests for the
 * receiving-service broker-auth middleware.
 *
 * Unlike broker-auth-middleware.test.ts (which doubles verifyDPoP), this suite
 * drives the REAL SDK `createVerifyDPoP` so the cnf.jkt enforcement path runs
 * with real ES256 crypto. validateToken + authorize are doubled so we control
 * the token's cnf.jkt independently of the proof's actual key — which is what
 * makes the stolen-token attack meaningful: we mint a token bound to key K1 but
 * present a proof signed by a DIFFERENT key K_attacker and assert rejection.
 *
 * Models the calling -> receiving hop: the broker minted cnf=thumbprint(K1)
 * from the exchange proof's key; the resource call must present a proof signed
 * by that same K1.
 *
 * Nonce is disabled here (requireNonce: false) to isolate the cnf check; the
 * nonce-vs-cnf precedence is covered by nonce.test.ts + the verifyDPoP unit
 * suite (nonce challenge fires before the cnf check inside verifyDPoP).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request } from 'express';
import request from 'supertest';
import { generateKeyPair, exportJWK, calculateJwkThumbprint } from 'jose';
import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { createVerifyDPoP } from '@s2s/auth-library';
import type { ValidatedToken } from '@s2s/auth-library';
import { createBrokerAuthMiddleware } from '../src/lib/brokerAuthMiddleware.js';

/** Minimal in-memory Redis stand-in covering the ops verifyDPoP uses (set NX for jti replay). */
function buildFakeRedis() {
  const store = new Map<string, string>();
  return {
    async set(key: string, val: string, _mode?: string, _ttl?: number, nx?: string) {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    },
    async get(key: string) { return store.get(key) ?? null; },
    async del(key: string) { return store.delete(key) ? 1 : 0; },
    async exists(key: string) { return store.has(key) ? 1 : 0; },
    async ping() { return 'PONG'; },
  } as never;
}

interface KeyPair {
  privateKey: CryptoKey;
  publicJwk: Record<string, unknown>;
  jkt: string;
}

async function genKey(): Promise<KeyPair> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  const publicJwk: Record<string, unknown> = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  const jkt = await calculateJwkThumbprint(publicJwk as never, 'sha256');
  return { privateKey: privateKey as unknown as CryptoKey, publicJwk, jkt };
}

/**
 * Sign a resource-call DPoP proof with the given key (embeds its public jwk).
 * Binds `ath = sha256(accessToken)` so it satisfies verifyDPoP's ath check and
 * the test reaches the cnf.jkt comparison (the behaviour under test).
 */
async function signProofWith(key: KeyPair, htm: string, htu: string, accessToken: string): Promise<string> {
  const ath = createHash('sha256').update(accessToken).digest('base64url');
  return new SignJWT({ htm, htu, jti: crypto.randomUUID(), ath })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk as never })
    .setIssuedAt()
    .sign(key.privateKey as never);
}

function makeValidated(cnfJkt: string | undefined): ValidatedToken {
  const base: ValidatedToken = {
    sub: 'user-alice',
    scope: ['receiving/write'],
    iss: 'http://broker',
    aud: 'receiving',
    exp: Math.floor(Date.now() / 1000) + 300,
    raw: {
      iss: 'http://broker',
      sub: 'user-alice',
      roles: ['lending-officer'],
      act: { sub: 'calling-service' },
    },
  };
  if (cnfJkt !== undefined) base.cnf = { jkt: cnfJkt };
  return base;
}

function buildApp(opts: { tokenCnfJkt: string | undefined }) {
  const verifyDPoP = createVerifyDPoP({
    redis: buildFakeRedis(),
    requireNonce: false,
    // Wide tolerance so freshly-signed proofs always pass the iat window.
    iatToleranceSeconds: 300,
  });
  const validateToken = vi.fn(async () => makeValidated(opts.tokenCnfJkt));
  const authorize = vi.fn(async () => ({ decision: 'ALLOW' as const, reasons: [] }));

  const mw = createBrokerAuthMiddleware({
    validateToken: validateToken as never,
    verifyDPoP: verifyDPoP as never,
    authorize: authorize as never,
    expectedAudience: 'receiving',
    resourcePrefix: 'lending',
    sourceDomain: 'receiving',
    action: 'POST_loan_application',
    resourceGroup: 'lending-resources',
  });
  const app = express();
  app.use(express.json());
  app.post('/api/loans', mw, (req: Request, res) => {
    res.status(200).json({ auth: (req as Request & { auth: unknown }).auth });
  });
  return app;
}

describe('receiving cnf.jkt sender-constraint (real crypto)', () => {
  let k1: KeyPair;
  let kAttacker: KeyPair;

  beforeEach(async () => {
    k1 = await genKey();
    kAttacker = await genKey();
  });

  it('happy: token cnf=K1 + resource proof signed by K1 -> ALLOW (thumbprint == cnf.jkt)', async () => {
    const app = buildApp({ tokenCnfJkt: k1.jkt });
    const proof = await signProofWith(k1, 'POST', 'http://127.0.0.1/api/loans', 'tok-good');
    const res = await request(app)
      .post('/api/loans')
      .set('host', '127.0.0.1')
      .set('authorization', 'DPoP tok-good')
      .set('dpop', proof)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.auth.sub).toBe('user-alice');
  });

  it('stolen-token: token cnf=K1 + proof signed by K_attacker -> 401 dpop_key_mismatch', async () => {
    const app = buildApp({ tokenCnfJkt: k1.jkt });
    // Attacker leaked the token (cnf=K1) but does not hold K1's private key, so
    // they sign the resource proof with their own key. Thumbprint != cnf.jkt.
    const proof = await signProofWith(kAttacker, 'POST', 'http://127.0.0.1/api/loans', 'stolen-tok');
    const res = await request(app)
      .post('/api/loans')
      .set('host', '127.0.0.1')
      .set('authorization', 'DPoP stolen-tok')
      .set('dpop', proof)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('dpop_key_mismatch');
  });

  it('missing cnf: token has no cnf.jkt + requireCnfBinding -> 401 dpop_key_mismatch', async () => {
    const app = buildApp({ tokenCnfJkt: undefined });
    const proof = await signProofWith(k1, 'POST', 'http://127.0.0.1/api/loans', 'tok-no-cnf');
    const res = await request(app)
      .post('/api/loans')
      .set('host', '127.0.0.1')
      .set('authorization', 'DPoP tok-no-cnf')
      .set('dpop', proof)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('dpop_key_mismatch');
  });
});
