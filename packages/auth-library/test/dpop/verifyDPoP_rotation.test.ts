import { describe, it, expect, beforeEach } from 'vitest';
import { initKeyPair, rotateKey, _resetKeyManagerForTest, _setNowForTest, getActiveKeys } from '../../src/dpop/keyManager.js';
import { signDPoP } from '../../src/dpop/signDPoP.js';
import { createVerifyDPoP } from '../../src/dpop/verifyDPoP.js';
import { RedisMock, asRedis } from '../helpers/redisMock.js';

describe('dpop verify across key rotation', () => {
  let redis: RedisMock;
  let nowMs: number;
  let verify: ReturnType<typeof createVerifyDPoP>;

  beforeEach(async () => {
    // signDPoP uses jose's setIssuedAt() which reads real wall-clock; anchor
    // our fake clock to Date.now() so the iat tolerance check is satisfied.
    nowMs = Date.now();
    _resetKeyManagerForTest();
    _setNowForTest(nowMs);
    await initKeyPair();
    redis = new RedisMock();
    redis.setNowFn(() => nowMs);
    verify = createVerifyDPoP({ redis: asRedis(redis), nowFn: () => nowMs, iatToleranceSeconds: 60 * 60 * 25 });
  });

  it('proof signed by old key remains acceptable during 2h overlap', async () => {
    const oldProof = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    nowMs += 23 * 3600 * 1000;
    _setNowForTest(nowMs);
    await rotateKey();
    expect(getActiveKeys().length).toBe(2);
    nowMs += 60 * 60 * 1000;
    _setNowForTest(nowMs);
    const r = await verify({ dpopProof: oldProof.proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
    expect(r.ok).toBe(true);
  });
});
