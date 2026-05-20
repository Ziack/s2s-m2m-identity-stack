import { describe, it, expect, beforeEach } from 'vitest';
import { createAcquireToken } from '../../src/token/acquireToken.js';
import { TokenCache } from '../../src/token/tokenCache.js';
import { buildBreaker, resetBreakersForTest } from '../../src/resilience/circuitBreaker.js';
import { RedisMock, asRedis } from '../helpers/redisMock.js';

describe('acquireToken + breaker', () => {
  beforeEach(() => resetBreakersForTest());

  it('opens the cognito breaker after 5 consecutive failures', async () => {
    const redis = new RedisMock();
    const cache = new TokenCache({ redis: asRedis(redis), nowFn: () => 1_700_000_000_000 });
    const breaker = buildBreaker('cognito', { failureThreshold: 5, halfOpenAfterMs: 30_000, samplingDurationMs: 60_000 });
    const fetchImpl = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    const acquire = createAcquireToken({
      cognitoDomain: 'https://x',
      clientSecret: 's',
      cache,
      fetchImpl,
      sleepFn: async () => {},
      breaker,
      retryConfig: { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 100 },
    });
    for (let i = 0; i < 5; i++) {
      await expect(acquire('c', ['s'])).rejects.toThrow();
    }
    let trippedQuickly = false;
    const t0 = Date.now();
    await expect(acquire('c', ['s'])).rejects.toThrow();
    if (Date.now() - t0 < 50) trippedQuickly = true;
    expect(trippedQuickly).toBe(true);
  });
});
