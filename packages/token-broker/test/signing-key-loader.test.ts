import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
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

  it('loads a PKCS#8 RSA key (the form Terraform now stores via private_key_pem_pkcs8)', async () => {
    // tls_private_key.private_key_pem_pkcs8 produces a PKCS#8 PEM. Mirror that
    // here to prove the loader imports it (this is the v2.1.2 secrets.tf fix).
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const loader = createSigningKeyLoader({
      secretArn: 'arn:test:secret',
      fetchSecret: async () => privateKey as string,
    });
    const k = await loader.get();
    expect(k.publicJwk.kty).toBe('RSA');
    expect(k.publicJwk.alg).toBe('RS256');
    expect(typeof k.kid).toBe('string');
  });

  it('rejects a PKCS#1 RSA key (the bug v2.1.2 fixes: TF previously stored private_key_pem / PKCS#1)', async () => {
    // tls_private_key.private_key_pem produces a PKCS#1 PEM for RSA keys, which
    // importPKCS8 cannot parse — this is exactly the failure the secrets.tf fix
    // avoids. Assert the loader surfaces an error rather than silently loading.
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const loader = createSigningKeyLoader({
      secretArn: 'arn:test:secret',
      fetchSecret: async () => privateKey as string,
    });
    await expect(loader.get()).rejects.toThrow();
  });
});
