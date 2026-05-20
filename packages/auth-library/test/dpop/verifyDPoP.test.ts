import { describe, it, expect, beforeEach } from 'vitest';
import { signDPoP } from '../../src/dpop/signDPoP.js';
import { createVerifyDPoP } from '../../src/dpop/verifyDPoP.js';
import { initKeyPair, _resetKeyManagerForTest } from '../../src/dpop/keyManager.js';
import { AuthError } from '../../src/errors.js';
import { RedisMock, asRedis } from '../helpers/redisMock.js';

describe('verifyDPoP', () => {
  let redis: RedisMock;
  let now: number;
  let verify: ReturnType<typeof createVerifyDPoP>;

  beforeEach(async () => {
    _resetKeyManagerForTest();
    await initKeyPair();
    redis = new RedisMock();
    now = Date.now(); // anchor to wall-clock so jose's setIssuedAt() falls within ±60s window
    redis.setNowFn(() => now);
    verify = createVerifyDPoP({ redis: asRedis(redis), nowFn: () => now, nonceTtlSeconds: 120 });
  });

  it('round-trips signed proof', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    const res = await verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
    expect(res.ok).toBe(true);
  });

  it('rejects htm mismatch', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'POST', htu: 'https://api/x' });
    await expect(verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' }))
      .rejects.toMatchObject({ code: 'dpop_binding_mismatch' } as Partial<AuthError>);
  });

  it('rejects htu mismatch', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    await expect(verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/y' }))
      .rejects.toMatchObject({ code: 'dpop_binding_mismatch' });
  });

  it('rejects ath mismatch (wrong access token)', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    await expect(verify({ dpopProof: proof, accessToken: 'other', expectedHtm: 'GET', expectedHtu: 'https://api/x' }))
      .rejects.toMatchObject({ code: 'dpop_token_mismatch' });
  });

  it('rejects proof outside ±60s', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    now += 90_000;
    await expect(verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' }))
      .rejects.toMatchObject({ code: 'dpop_proof_expired' });
  });

  it('rejects replayed jti', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    await verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
    await expect(verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' }))
      .rejects.toMatchObject({ code: 'dpop_nonce_reuse' });
  });

  it('rejects tampered signature', async () => {
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    const parts = proof.split('.');
    const tampered = `${parts[0]}.${parts[1]}.AAAA${parts[2]?.slice(4) ?? ''}`;
    await expect(verify({ dpopProof: tampered, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' }))
      .rejects.toMatchObject({ code: 'invalid_dpop_proof' });
  });
});
