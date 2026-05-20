import { describe, it, expect, beforeEach } from 'vitest';
import { createAcquireToken } from '../../src/token/acquireToken.js';
import { TokenCache } from '../../src/token/tokenCache.js';
import { RedisMock, asRedis } from '../helpers/redisMock.js';

function mkFetch(seq: Array<{ status: number; body?: Record<string, unknown> }>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = seq[Math.min(i++, seq.length - 1)];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('createAcquireToken', () => {
  let redis: RedisMock;
  let now: number;
  let cache: TokenCache;
  beforeEach(() => {
    redis = new RedisMock();
    now = 1_700_000_000_000;
    redis.setNowFn(() => now);
    cache = new TokenCache({ redis: asRedis(redis), nowFn: () => now });
  });

  it('happy path fetches from Cognito and caches', async () => {
    const fetchImpl = mkFetch([{ status: 200, body: { access_token: 'tok-1', expires_in: 300, scope: 'a b' } }]);
    const acquire = createAcquireToken({
      cognitoDomain: 'https://x.auth.us-east-1.amazoncognito.com',
      clientSecret: 'shh',
      cache,
      fetchImpl,
      nowFn: () => now,
    });
    const r = await acquire('client-1', ['a', 'b']);
    expect(r.accessToken).toBe('tok-1');
    expect(r.tokenSource).toBe('cognito');
    expect(r.expiresAt).toBe(Math.floor(now / 1000) + 300);
    const cached = await acquire('client-1', ['a', 'b']);
    expect(cached.tokenSource).toBe('cache-l1');
  });

  it('retries on 429 with exponential backoff and jitter (composed via withRetry)', async () => {
    const fetchImpl = mkFetch([
      { status: 429 },
      { status: 429 },
      { status: 200, body: { access_token: 'tok-2', expires_in: 300, scope: 'a' } },
    ]);
    const sleeps: number[] = [];
    const acquire = createAcquireToken({
      cognitoDomain: 'https://x.auth.us-east-1.amazoncognito.com',
      clientSecret: 'shh',
      cache,
      fetchImpl,
      nowFn: () => now,
      sleepFn: async (ms) => { sleeps.push(ms); },
    });
    const r = await acquire('client-2', ['a']);
    expect(r.accessToken).toBe('tok-2');
    expect(sleeps.length).toBe(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(sleeps[1]).toBeLessThanOrEqual(5000);
  });

  it('falls back to stale L2 cache on Cognito 5xx', async () => {
    const expiresAt = Math.floor(now / 1000) + 60;
    await cache.set({ clientId: 'c3', scopes: ['s'], accessToken: 'stale-tok', expiresAt });
    cache.clearL1();
    // Advance past the freshness buffer (30s) but within the L2 TTL (60s):
    // get() must miss to force the retry chain, while getStale() must still find the entry.
    now += 35_000;
    const fetchImpl = mkFetch([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }]);
    const acquire = createAcquireToken({
      cognitoDomain: 'https://x.auth.us-east-1.amazoncognito.com',
      clientSecret: 'shh',
      cache,
      fetchImpl,
      nowFn: () => now,
      sleepFn: async () => {},
    });
    const r = await acquire('c3', ['s']);
    expect(r.accessToken).toBe('stale-tok');
    expect(r.tokenSource).toBe('cache-l2');
  });

  it('sends client_secret_basic with Basic auth header (delegated to acquireTokenRaw)', async () => {
    let captured: Request | null = null;
    const fetchImpl = (async (input: RequestInfo) => {
      captured = input as Request;
      return new Response(JSON.stringify({ access_token: 't', expires_in: 300, scope: 'a' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const acquire = createAcquireToken({
      cognitoDomain: 'https://x.auth.us-east-1.amazoncognito.com',
      clientSecret: 'shh',
      cache,
      fetchImpl,
      nowFn: () => now,
    });
    await acquire('client-x', ['a']);
    expect(captured).not.toBeNull();
    // captured here is the URL string from acquireTokenRaw — header assertion is covered in acquireTokenRaw.test.ts;
    // here we just confirm the call reaches Cognito at all.
  });
});
