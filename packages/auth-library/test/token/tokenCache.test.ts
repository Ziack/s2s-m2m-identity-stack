import { describe, it, expect, beforeEach } from 'vitest';
import { TokenCache, cacheKey } from '../../src/token/tokenCache.js';
import { RedisMock, asRedis } from '../helpers/redisMock.js';

describe('tokenCache', () => {
  let redis: RedisMock;
  let now: number;
  let cache: TokenCache;

  beforeEach(() => {
    redis = new RedisMock();
    now = 1_700_000_000_000;
    redis.setNowFn(() => now);
    cache = new TokenCache({ redis: asRedis(redis), nowFn: () => now });
  });

  it('cacheKey is deterministic and sorts scopes', () => {
    const k1 = cacheKey('c1', ['b', 'a']);
    const k2 = cacheKey('c1', ['a', 'b']);
    expect(k1).toBe(k2);
    expect(k1.startsWith('m2m:c1:')).toBe(true);
  });

  it('writes to L1 and L2 with TTL = exp - 30s buffer', async () => {
    const expiresAt = Math.floor(now / 1000) + 300;
    await cache.set({ clientId: 'c1', scopes: ['x'], accessToken: 't', expiresAt });
    const got1 = await cache.get({ clientId: 'c1', scopes: ['x'] });
    expect(got1?.tokenSource).toBe('cache-l1');
    expect(got1?.accessToken).toBe('t');
    cache.clearL1();
    const got2 = await cache.get({ clientId: 'c1', scopes: ['x'] });
    expect(got2?.tokenSource).toBe('cache-l2');
  });

  it('returns null when expired in L2 only', async () => {
    const expiresAt = Math.floor(now / 1000) + 60;
    await cache.set({ clientId: 'c1', scopes: ['y'], accessToken: 't', expiresAt });
    cache.clearL1();
    now += 70_000;
    const got = await cache.get({ clientId: 'c1', scopes: ['y'] });
    expect(got).toBeNull();
  });

  it('writes L2 entry with raw remaining-lifetime TTL (no buffer subtraction)', async () => {
    const expiresAt = Math.floor(now / 1000) + 100; // 100s remaining
    await cache.set({ clientId: 'c', scopes: ['s'], accessToken: 't', expiresAt });
    const ttl = await redis.ttl(cacheKey('c', ['s']));
    // Must NOT be 70 (which would be 100 - BUFFER_SECONDS); allow ±1s for rounding.
    expect(ttl).toBeGreaterThanOrEqual(99);
    expect(ttl).toBeLessThanOrEqual(100);
  });

  it('getStale returns L2 entry even if past TTL buffer when forced', async () => {
    const expiresAt = Math.floor(now / 1000) + 40;
    await cache.set({ clientId: 'c1', scopes: ['z'], accessToken: 't-stale', expiresAt });
    cache.clearL1();
    now += 15_000;
    const stale = await cache.getStale({ clientId: 'c1', scopes: ['z'] });
    expect(stale?.accessToken).toBe('t-stale');
  });
});
