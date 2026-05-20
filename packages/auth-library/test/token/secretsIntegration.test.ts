import { describe, it, expect, beforeEach } from 'vitest';
import { getClientSecret, setSecretsClientForTest, resetSecretsCacheForTest } from '../../src/secrets.js';

describe('secrets loader integration with acquireToken pipeline', () => {
  beforeEach(() => {
    resetSecretsCacheForTest();
  });

  it('exposes getClientSecret(arn, region) returning the SecretString once cached', async () => {
    let calls = 0;
    const fake = { send: async () => { calls++; return { SecretString: 'shh-pipeline' }; } } as unknown as Parameters<typeof setSecretsClientForTest>[0];
    setSecretsClientForTest(fake);
    const s1 = await getClientSecret('arn:test:1', 'us-east-1');
    const s2 = await getClientSecret('arn:test:1', 'us-east-1');
    expect(s1).toBe('shh-pipeline');
    expect(s2).toBe('shh-pipeline');
    expect(calls).toBe(1);
  });

  it('is callable as a clientSecretProvider supplier shape (string Promise)', async () => {
    const fake = { send: async () => ({ SecretString: 'shh-2' }) } as unknown as Parameters<typeof setSecretsClientForTest>[0];
    setSecretsClientForTest(fake);
    const provider = (): Promise<string> => getClientSecret('arn:test:2', 'us-east-1');
    await expect(provider()).resolves.toBe('shh-2');
  });
});
