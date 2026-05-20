import { describe, it, expect, beforeEach } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import { initKeyPair, _resetKeyManagerForTest } from '../src/dpop/keyManager.js';
import { signDPoP } from '../src/dpop/signDPoP.js';
import { createVerifyDPoP } from '../src/dpop/verifyDPoP.js';
import { signEnvelope } from '../src/envelope/signEnvelope.js';
import { createVerifyEnvelope } from '../src/envelope/verifyEnvelope.js';
import { RedisMock, asRedis } from './helpers/redisMock.js';

describe('security scenarios (§5.3)', () => {
  let redis: RedisMock;
  let now: number;
  beforeEach(async () => {
    _resetKeyManagerForTest();
    await initKeyPair();
    redis = new RedisMock();
    // Anchor to wall-clock — see Task 15 beforeEach for rationale.
    now = Date.now();
    redis.setNowFn(() => now);
  });

  it('rejects replayed DPoP proof', async () => {
    const verify = createVerifyDPoP({ redis: asRedis(redis), nowFn: () => now });
    const { proof } = await signDPoP({ accessToken: 'tok', htm: 'GET', htu: 'https://api/x' });
    await verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' });
    await expect(verify({ dpopProof: proof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' }))
      .rejects.toMatchObject({ code: 'dpop_nonce_reuse' });
  });

  it('rejects DPoP signed with a stolen-but-different keypair', async () => {
    const attackerKey = await generateKeyPair('ES256', { extractable: true });
    const forgedProof = await new SignJWT({ htm: 'GET', htu: 'https://api/x', jti: 'forged', ath: 'wrong', iat: Math.floor(now / 1000) })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' } })
      .sign(attackerKey.privateKey);
    const verify = createVerifyDPoP({ redis: asRedis(redis), nowFn: () => now });
    await expect(verify({ dpopProof: forgedProof, accessToken: 'tok', expectedHtm: 'GET', expectedHtu: 'https://api/x' }))
      .rejects.toMatchObject({ code: 'invalid_dpop_proof' });
  });

  it('rejects tampered envelope payload (body_hash mismatch)', async () => {
    const verify = createVerifyEnvelope({ redis: asRedis(redis), nowFn: () => now });
    const signed = await signEnvelope({ x: 1 }, { action: 'a', queueArn: 'q', scopes: [], clientId: 'svc' });
    await expect(verify({ envelope: signed.envelope, payload: { x: 2 } }, { expectedQueueArn: 'q', queueType: 'sqs_standard' }))
      .rejects.toThrow(/body_hash/);
  });

  it('rejects envelope sent to wrong queue (cross-queue replay)', async () => {
    const verify = createVerifyEnvelope({ redis: asRedis(redis), nowFn: () => now });
    const signed = await signEnvelope({}, { action: 'a', queueArn: 'qA', scopes: [], clientId: 'svc' });
    await expect(verify({ envelope: signed.envelope, payload: {} }, { expectedQueueArn: 'qB', queueType: 'sqs_standard' }))
      .rejects.toThrow(/queue_arn/);
  });
});
