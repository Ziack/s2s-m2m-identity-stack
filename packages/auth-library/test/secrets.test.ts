import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getClientSecret,
  invalidateClientSecret,
  setSecretsClientForTest,
  setNowFnForTest,
  resetSecretsCacheForTest,
} from '../src/secrets.js';

describe('secrets', () => {
  beforeEach(() => {
    resetSecretsCacheForTest();
    setNowFnForTest(null);
  });

  afterEach(() => {
    setSecretsClientForTest(null);
    setNowFnForTest(null);
  });

  it('returns the SecretString and caches it', async () => {
    let calls = 0;
    const fake = { send: async () => { calls++; return { SecretString: 'shh' }; } } as unknown as Parameters<typeof setSecretsClientForTest>[0];
    setSecretsClientForTest(fake);
    expect(await getClientSecret('arn:1', 'us-east-1')).toBe('shh');
    expect(await getClientSecret('arn:1', 'us-east-1')).toBe('shh');
    expect(calls).toBe(1);
  });

  it('throws when SecretString missing', async () => {
    const fake = { send: async () => ({}) } as unknown as Parameters<typeof setSecretsClientForTest>[0];
    setSecretsClientForTest(fake);
    await expect(getClientSecret('arn:2', 'us-east-1')).rejects.toThrow(/has no SecretString/);
  });

  it('returns cached value within TTL without re-fetching', async () => {
    let calls = 0;
    let nowMs = 1_000_000;
    setNowFnForTest(() => nowMs);
    const fake = { send: async () => { calls++; return { SecretString: `v${calls}` }; } } as unknown as Parameters<typeof setSecretsClientForTest>[0];
    setSecretsClientForTest(fake);

    expect(await getClientSecret('arn:ttl', { ttlMs: 60_000 })).toBe('v1');
    nowMs += 30_000; // within TTL
    expect(await getClientSecret('arn:ttl', { ttlMs: 60_000 })).toBe('v1');
    expect(calls).toBe(1);
  });

  it('re-fetches after TTL expires', async () => {
    let calls = 0;
    let nowMs = 1_000_000;
    setNowFnForTest(() => nowMs);
    const fake = { send: async () => { calls++; return { SecretString: `v${calls}` }; } } as unknown as Parameters<typeof setSecretsClientForTest>[0];
    setSecretsClientForTest(fake);

    expect(await getClientSecret('arn:ttl2', { ttlMs: 60_000 })).toBe('v1');
    nowMs += 60_001; // past TTL
    expect(await getClientSecret('arn:ttl2', { ttlMs: 60_000 })).toBe('v2');
    expect(calls).toBe(2);
  });

  it('invalidateClientSecret forces a fresh fetch on next call', async () => {
    let calls = 0;
    const fake = { send: async () => { calls++; return { SecretString: `v${calls}` }; } } as unknown as Parameters<typeof setSecretsClientForTest>[0];
    setSecretsClientForTest(fake);

    expect(await getClientSecret('arn:inv', 'us-east-1')).toBe('v1');
    expect(await getClientSecret('arn:inv', 'us-east-1')).toBe('v1');
    expect(calls).toBe(1);
    invalidateClientSecret('arn:inv');
    expect(await getClientSecret('arn:inv', 'us-east-1')).toBe('v2');
    expect(calls).toBe(2);
  });

  it('caches distinct ARNs independently', async () => {
    let calls = 0;
    const fake = {
      send: async (cmd: { input: { SecretId: string } }) => {
        calls++;
        return { SecretString: `secret-for-${cmd.input.SecretId}` };
      },
    } as unknown as Parameters<typeof setSecretsClientForTest>[0];
    setSecretsClientForTest(fake);

    expect(await getClientSecret('arn:A', 'us-east-1')).toBe('secret-for-arn:A');
    expect(await getClientSecret('arn:B', 'us-east-1')).toBe('secret-for-arn:B');
    expect(await getClientSecret('arn:A', 'us-east-1')).toBe('secret-for-arn:A');
    expect(await getClientSecret('arn:B', 'us-east-1')).toBe('secret-for-arn:B');
    expect(calls).toBe(2);
  });
});
