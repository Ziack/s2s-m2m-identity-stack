import { describe, it, expect, beforeEach } from 'vitest';
import { signDPoP } from '../../src/dpop/signDPoP.js';
import { createVerifyDPoP } from '../../src/dpop/verifyDPoP.js';
import { createRedisNonceStore, generateDPoPNonce } from '../../src/dpop/dpopNonce.js';
import { initKeyPair, _resetKeyManagerForTest } from '../../src/dpop/keyManager.js';
import { AuthError } from '../../src/errors.js';
import { RedisMock, asRedis } from '../helpers/redisMock.js';

describe('DPoP nonce challenge/echo (RFC 9449 §8)', () => {
  let redis: RedisMock;
  let now: number;
  let verify: ReturnType<typeof createVerifyDPoP>;
  let nonceStore: ReturnType<typeof createRedisNonceStore>;

  beforeEach(async () => {
    _resetKeyManagerForTest();
    await initKeyPair();
    redis = new RedisMock();
    // Anchor to wall-clock — see Task 15 beforeEach for rationale.
    now = Date.now();
    redis.setNowFn(() => now);
    nonceStore = createRedisNonceStore({ redis: asRedis(redis), ttlSeconds: 300 });
    verify = createVerifyDPoP({ redis: asRedis(redis), nowFn: () => now, nonceStore, requireNonce: true });
  });

  it('generateDPoPNonce returns a base64url 32-byte value', () => {
    const n = generateDPoPNonce();
    expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes -> 43 chars base64url no padding
    expect(n.length).toBeGreaterThanOrEqual(43);
  });

  it('accepts a proof whose nonce matches an issued nonce', async () => {
    const fresh = generateDPoPNonce();
    await nonceStore.issue(fresh);
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x', nonce: fresh });
    const r = await verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
    expect(r.ok).toBe(true);
  });

  it('rejects reused nonce — second use issues fresh challenge (RFC 9449 §8)', async () => {
    const fresh = generateDPoPNonce();
    await nonceStore.issue(fresh);
    const p1 = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x', nonce: fresh });
    await verify({ dpopProof: p1.proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
    const p2 = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x', nonce: fresh });
    await expect(verify({ dpopProof: p2.proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' }))
      .rejects.toMatchObject({ code: 'use_dpop_nonce' } as Partial<AuthError>);
  });

  it('when proof has no nonce and requireNonce=true, throws use_dpop_nonce with a fresh challenge', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    try {
      await verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as AuthError & { challengeNonce?: string };
      expect(err.code).toBe('use_dpop_nonce');
      expect(err.status).toBe(401);
      expect(typeof err.challengeNonce).toBe('string');
      expect(err.challengeNonce!.length).toBeGreaterThanOrEqual(43);
    }
  });

  it('issues fresh DPoP-Nonce challenge when proof presents unknown nonce (RFC 9449 §8)', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x', nonce: 'fake-nonce-not-issued' });
    try {
      await verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as AuthError & { challengeNonce?: string };
      expect(err.code).toBe('use_dpop_nonce');
      expect(err.status).toBe(401);
      expect(typeof err.challengeNonce).toBe('string');
      expect(err.challengeNonce!.length).toBeGreaterThanOrEqual(43);
    }
  });

  it('requireNonce defaults to false — backward compatible', async () => {
    const v2 = createVerifyDPoP({ redis: asRedis(redis), nowFn: () => now });
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    const r = await v2({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
    expect(r.ok).toBe(true);
  });
});
