import { describe, it, expect } from 'vitest';
import { acquireTokenWithRetry } from '../../src/token/acquireTokenRetry.js';
import { CognitoTokenError } from '../../src/token/acquireTokenRaw.js';

function mkFetch(seq: Array<{ status: number; body?: Record<string, unknown> }>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = seq[Math.min(i++, seq.length - 1)];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('acquireTokenWithRetry', () => {
  it('returns immediately on 200 (no sleep)', async () => {
    const sleeps: number[] = [];
    const fetchImpl = mkFetch([{ status: 200, body: { access_token: 't', expires_in: 300, scope: 'a' } }]);
    const r = await acquireTokenWithRetry(
      { cognitoDomain: 'https://x', clientId: 'c', clientSecret: 's', scopes: ['a'], fetchImpl },
      { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 5000, sleepFn: async (ms) => { sleeps.push(ms); } },
    );
    expect(r.access_token).toBe('t');
    expect(sleeps.length).toBe(0);
  });

  it('retries on 429 then 5xx with exponential delay bounded by maxDelayMs', async () => {
    const sleeps: number[] = [];
    const fetchImpl = mkFetch([
      { status: 429 },
      { status: 503 },
      { status: 200, body: { access_token: 'tok-2', expires_in: 300, scope: 'a' } },
    ]);
    const r = await acquireTokenWithRetry(
      { cognitoDomain: 'https://x', clientId: 'c', clientSecret: 's', scopes: ['a'], fetchImpl },
      { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 5000, sleepFn: async (ms) => { sleeps.push(ms); } },
    );
    expect(r.access_token).toBe('tok-2');
    expect(sleeps.length).toBe(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(sleeps[0]).toBeLessThanOrEqual(200); // base 100 + jitter up to 100
    expect(sleeps[1]).toBeGreaterThanOrEqual(200);
    expect(sleeps[1]).toBeLessThanOrEqual(400); // base 200 + jitter up to 200
    for (const s of sleeps) expect(s).toBeLessThanOrEqual(10_000);
  });

  it('does NOT retry on 4xx non-429 (immediately throws)', async () => {
    const sleeps: number[] = [];
    const fetchImpl = mkFetch([{ status: 401 }]);
    await expect(
      acquireTokenWithRetry(
        { cognitoDomain: 'https://x', clientId: 'c', clientSecret: 's', scopes: ['a'], fetchImpl },
        { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 5000, sleepFn: async (ms) => { sleeps.push(ms); } },
      ),
    ).rejects.toMatchObject({ name: 'CognitoTokenError', status: 401 });
    expect(sleeps.length).toBe(0);
  });

  it('throws after maxRetries on persistent 5xx', async () => {
    const sleeps: number[] = [];
    const fetchImpl = mkFetch([{ status: 503 }]);
    await expect(
      acquireTokenWithRetry(
        { cognitoDomain: 'https://x', clientId: 'c', clientSecret: 's', scopes: ['a'], fetchImpl },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, sleepFn: async (ms) => { sleeps.push(ms); } },
      ),
    ).rejects.toBeInstanceOf(CognitoTokenError);
    expect(sleeps.length).toBe(3);
  });
});
