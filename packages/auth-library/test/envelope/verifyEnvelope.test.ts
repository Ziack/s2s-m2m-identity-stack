import { describe, it, expect, beforeEach } from 'vitest';
import { initKeyPair, _resetKeyManagerForTest } from '../../src/dpop/keyManager.js';
import { signEnvelope } from '../../src/envelope/signEnvelope.js';
import { createVerifyEnvelope, DEFAULT_STALENESS } from '../../src/envelope/verifyEnvelope.js';
import { RedisMock, asRedis } from '../helpers/redisMock.js';

describe('verifyEnvelope', () => {
  let redis: RedisMock;
  let now: number;
  let verify: ReturnType<typeof createVerifyEnvelope>;

  beforeEach(async () => {
    _resetKeyManagerForTest();
    await initKeyPair();
    redis = new RedisMock();
    // signEnvelope stamps `iat` from real Date.now() (via jose). Anchor the
    // fake clock to wall-clock so the staleness check doesn't immediately
    // reject fresh envelopes. Tests advance with `now += N_000` from here.
    now = Date.now();
    redis.setNowFn(() => now);
    verify = createVerifyEnvelope({ redis: asRedis(redis), nowFn: () => now });
  });

  it('round-trips a signed envelope', async () => {
    const payload = { x: 1 };
    const signed = await signEnvelope(payload, { action: 'a', queueArn: 'q1', scopes: ['s'], clientId: 'svc' });
    const r = await verify({ envelope: signed.envelope, payload }, { expectedQueueArn: 'q1', queueType: 'sqs_standard' });
    expect(r.principal).toBe('M2M::ServicePrincipal::svc');
    expect(r.action).toBe('a');
  });

  it('rejects tampered payload (body_hash mismatch)', async () => {
    const payload = { x: 1 };
    const signed = await signEnvelope(payload, { action: 'a', queueArn: 'q1', scopes: ['s'], clientId: 'svc' });
    await expect(verify({ envelope: signed.envelope, payload: { x: 2 } }, { expectedQueueArn: 'q1', queueType: 'sqs_standard' }))
      .rejects.toThrow(/body_hash/);
  });

  it('rejects cross-queue replay (queue_arn mismatch)', async () => {
    const payload = {};
    const signed = await signEnvelope(payload, { action: 'a', queueArn: 'q1', scopes: ['s'], clientId: 'svc' });
    await expect(verify({ envelope: signed.envelope, payload }, { expectedQueueArn: 'q2', queueType: 'sqs_standard' }))
      .rejects.toThrow(/queue_arn/);
  });

  it('rejects stale envelope past threshold', async () => {
    const payload = {};
    const signed = await signEnvelope(payload, { action: 'a', queueArn: 'q1', scopes: ['s'], clientId: 'svc' });
    now += DEFAULT_STALENESS.sqs_standard * 1000 + 1000;
    await expect(verify({ envelope: signed.envelope, payload }, { expectedQueueArn: 'q1', queueType: 'sqs_standard' }))
      .rejects.toThrow(/stale/);
  });

  it('dedups jti unless skipDedup', async () => {
    const signed = await signEnvelope({}, { action: 'a', queueArn: 'q1', scopes: [], clientId: 'svc' });
    await verify({ envelope: signed.envelope, payload: {} }, { expectedQueueArn: 'q1', queueType: 'sqs_standard' });
    await expect(verify({ envelope: signed.envelope, payload: {} }, { expectedQueueArn: 'q1', queueType: 'sqs_standard' }))
      .rejects.toThrow(/dedup/);
  });
});
