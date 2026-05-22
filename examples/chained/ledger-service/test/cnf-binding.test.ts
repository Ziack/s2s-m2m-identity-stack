/**
 * RFC 9449 §6 sender-constraint (cnf.jkt) tests for the ledger-service
 * broker-auth middleware — the terminal hop in calling -> receiving -> ledger.
 *
 * Drives the REAL SDK `createVerifyDPoP` (real ES256 crypto) while doubling
 * validateToken + authorize so we control the token's cnf.jkt independently of
 * the proof's key. Models the receiving -> ledger hop: receiving re-exchanged
 * with its key K2, the broker minted cnf=thumbprint(K2), and the resource call
 * must present a proof signed by that same K2.
 *
 * The stolen-token case uses a genuinely different attacker key so the
 * rejection proves a leaked token cannot be replayed without the bound key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request } from 'express';
import request from 'supertest';
import { generateKeyPair, exportJWK, calculateJwkThumbprint, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { createVerifyDPoP } from '@s2s/auth-library';
import type { ValidatedToken } from '@s2s/auth-library';
import { createBrokerAuthMiddleware } from '../src/lib/brokerAuthMiddleware.js';

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
    scope: ['ledger/write'],
    iss: 'http://broker',
    aud: 'ledger',
    exp: Math.floor(Date.now() / 1000) + 300,
    raw: {
      iss: 'http://broker',
      sub: 'user-alice',
      roles: ['lending-officer'],
      act: { sub: 'receiving-service-outbound', act: { sub: 'calling-service' } },
    },
  };
  if (cnfJkt !== undefined) base.cnf = { jkt: cnfJkt };
  return base;
}

function buildApp(opts: { tokenCnfJkt: string | undefined }) {
  const verifyDPoP = createVerifyDPoP({
    redis: buildFakeRedis(),
    requireNonce: false,
    iatToleranceSeconds: 300,
  });
  const validateToken = vi.fn(async () => makeValidated(opts.tokenCnfJkt));
  const authorize = vi.fn(async () => ({ decision: 'ALLOW' as const, reasons: [] }));

  const mw = createBrokerAuthMiddleware({
    validateToken: validateToken as never,
    verifyDPoP: verifyDPoP as never,
    authorize: authorize as never,
    expectedAudience: 'ledger',
    resourcePrefix: 'ledger',
    sourceDomain: 'ledger',
    action: 'POST_ledger_entry',
    resourceGroup: 'ledger-resources',
  });
  const app = express();
  app.use(express.json());
  app.post('/api/ledger/entries', mw, (req: Request, res) => {
    res.status(200).json({ auth: (req as Request & { auth: unknown }).auth });
  });
  return app;
}

describe('ledger cnf.jkt sender-constraint (real crypto)', () => {
  let k2: KeyPair;
  let kAttacker: KeyPair;

  beforeEach(async () => {
    k2 = await genKey();
    kAttacker = await genKey();
  });

  it('happy: token cnf=K2 + resource proof signed by K2 -> ALLOW', async () => {
    const app = buildApp({ tokenCnfJkt: k2.jkt });
    const proof = await signProofWith(k2, 'POST', 'http://127.0.0.1/api/ledger/entries', 'tok-good');
    const res = await request(app)
      .post('/api/ledger/entries')
      .set('host', '127.0.0.1')
      .set('authorization', 'DPoP tok-good')
      .set('dpop', proof)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.auth.user.sub).toBe('user-alice');
  });

  it('stolen-token: token cnf=K2 + proof signed by K_attacker -> 401 dpop_key_mismatch', async () => {
    const app = buildApp({ tokenCnfJkt: k2.jkt });
    const proof = await signProofWith(kAttacker, 'POST', 'http://127.0.0.1/api/ledger/entries', 'stolen-tok');
    const res = await request(app)
      .post('/api/ledger/entries')
      .set('host', '127.0.0.1')
      .set('authorization', 'DPoP stolen-tok')
      .set('dpop', proof)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('dpop_key_mismatch');
  });

  it('missing cnf: token has no cnf.jkt + requireCnfBinding -> 401 dpop_key_mismatch', async () => {
    const app = buildApp({ tokenCnfJkt: undefined });
    const proof = await signProofWith(k2, 'POST', 'http://127.0.0.1/api/ledger/entries', 'tok-no-cnf');
    const res = await request(app)
      .post('/api/ledger/entries')
      .set('host', '127.0.0.1')
      .set('authorization', 'DPoP tok-no-cnf')
      .set('dpop', proof)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('dpop_key_mismatch');
  });
});
