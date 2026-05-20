import { describe, it, expect, beforeEach } from 'vitest';
import { createJwksManager } from '../../src/validation/jwksManager.js';

const SAMPLE_JWKS = { keys: [{ kty: 'RSA', kid: 'k1', n: 'abc', e: 'AQAB', alg: 'RS256', use: 'sig' }] };

describe('jwksManager', () => {
  let fetches = 0;
  beforeEach(() => { fetches = 0; });

  function makeFetch(): typeof fetch {
    return (async () => {
      fetches++;
      return new Response(JSON.stringify(SAMPLE_JWKS), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
  }

  it('caches and only fetches once within the TTL', async () => {
    const m = createJwksManager({ jwksUri: 'https://issuer/.well-known/jwks.json', refreshHours: 24, fetchImpl: makeFetch(), nowFn: () => 0 });
    const a = await m.getKeys();
    const b = await m.getKeys();
    expect(a).toBe(b);
    expect(fetches).toBe(1);
  });

  it('refreshes when forceRefresh=true', async () => {
    const m = createJwksManager({ jwksUri: 'https://issuer/.well-known/jwks.json', refreshHours: 24, fetchImpl: makeFetch(), nowFn: () => 0 });
    await m.getKeys();
    await m.getKeys({ forceRefresh: true });
    expect(fetches).toBe(2);
  });

  it('refreshes after refreshHours elapsed', async () => {
    let t = 0;
    const m = createJwksManager({ jwksUri: 'https://issuer/.well-known/jwks.json', refreshHours: 1, fetchImpl: makeFetch(), nowFn: () => t });
    await m.getKeys();
    t = 3600_001;
    await m.getKeys();
    expect(fetches).toBe(2);
  });

  it('jwksLastRefreshAt returns the timestamp of the most recent fetch', async () => {
    const { jwksLastRefreshAt, _resetJwksLastRefreshForTest } = await import('../../src/validation/jwksManager.js');
    _resetJwksLastRefreshForTest();
    expect(jwksLastRefreshAt()).toBe(null);
    let t = 5_000;
    const m = createJwksManager({ jwksUri: 'https://issuer/.well-known/jwks.json', refreshHours: 24, fetchImpl: makeFetch(), nowFn: () => t });
    await m.getKeys();
    expect(jwksLastRefreshAt()).toBe(5_000);
    t = 9_000;
    await m.getKeys({ forceRefresh: true });
    expect(jwksLastRefreshAt()).toBe(9_000);
  });
});
