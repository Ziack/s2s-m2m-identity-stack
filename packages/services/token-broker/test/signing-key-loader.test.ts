import { describe, it, expect, beforeAll } from 'vitest';
import { createSigningKeyLoader } from '../src/lib/signingKeyLoader.js';
import { makeRsaKey, type TestKeyMaterial } from './helpers/testFixtures.js';

describe('signingKeyLoader', () => {
  let km: TestKeyMaterial;
  beforeAll(async () => {
    km = await makeRsaKey();
  });

  it('loads a PEM private key, derives RFC 7638 kid, and publishes public JWK', async () => {
    const loader = createSigningKeyLoader({
      secretArn: 'arn:test:secret',
      fetchSecret: async () => km.privatePem,
    });
    const k = await loader.get();
    expect(k.kid).toBe(km.kid);
    expect(k.publicJwk.kty).toBe('RSA');
    expect(k.publicJwk.use).toBe('sig');
    expect(k.publicJwk.alg).toBe('RS256');
    expect(k.publicJwk.kid).toBe(km.kid);
  });

  it('caches subsequent loads until TTL elapses', async () => {
    let calls = 0;
    let now = 1_700_000_000_000;
    const loader = createSigningKeyLoader({
      secretArn: 'arn:test:secret',
      ttlMs: 1_000,
      nowFn: () => now,
      fetchSecret: async () => {
        calls++;
        return km.privatePem;
      },
    });
    await loader.get();
    await loader.get();
    expect(calls).toBe(1);
    now += 2_000; // past TTL
    await loader.get();
    expect(calls).toBe(2);
  });

  it('invalidate() clears the cache so next get() refetches', async () => {
    let calls = 0;
    const loader = createSigningKeyLoader({
      secretArn: 'arn:test:secret',
      fetchSecret: async () => {
        calls++;
        return km.privatePem;
      },
    });
    await loader.get();
    loader.invalidate();
    await loader.get();
    expect(calls).toBe(2);
  });

  it('throws on non-PEM input', async () => {
    const loader = createSigningKeyLoader({
      secretArn: 'arn:test:secret',
      fetchSecret: async () => 'not-a-pem',
    });
    await expect(loader.get()).rejects.toThrow(/PEM/);
  });
});
