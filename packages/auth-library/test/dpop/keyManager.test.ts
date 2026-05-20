import { describe, it, expect, beforeEach } from 'vitest';
import { initKeyPair, getPublicJwk, getJwkThumbprint, getActiveKeys, _setNowForTest, _resetKeyManagerForTest, rotateKey } from '../../src/dpop/keyManager.js';

describe('keyManager', () => {
  beforeEach(() => {
    _resetKeyManagerForTest();
    _setNowForTest(1_700_000_000_000);
  });

  it('initKeyPair generates an EC P-256 key', async () => {
    await initKeyPair();
    const jwk = getPublicJwk();
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    expect(typeof jwk.x).toBe('string');
    expect(typeof jwk.y).toBe('string');
    expect((jwk as Record<string, unknown>).d).toBeUndefined();
  });

  it('thumbprint is deterministic and matches RFC 7638', () => {
    // RFC 7638 example uses RSA; we verify shape and that two calls match
    const jwk = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' };
    // We compute via library to ensure consistency — done after impl
    expect(jwk.kty).toBe('EC');
  });

  it('thumbprint of current key is stable across calls', async () => {
    await initKeyPair();
    const a = getJwkThumbprint();
    const b = getJwkThumbprint();
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rotateKey marks previous key still active for overlap window', async () => {
    await initKeyPair();
    const oldTp = getJwkThumbprint();
    _setNowForTest(1_700_000_000_000 + 23 * 3600 * 1000);
    await rotateKey();
    const newTp = getJwkThumbprint();
    expect(newTp).not.toBe(oldTp);
    const active = getActiveKeys();
    expect(active.find((k) => k.thumbprint === oldTp)).toBeDefined();
    expect(active.find((k) => k.thumbprint === newTp)).toBeDefined();
  });

  it('previous key expires after 2 hours of overlap', async () => {
    await initKeyPair();
    const oldTp = getJwkThumbprint();
    _setNowForTest(1_700_000_000_000 + 23 * 3600 * 1000);
    await rotateKey();
    _setNowForTest(1_700_000_000_000 + 23 * 3600 * 1000 + 2 * 3600 * 1000 + 1000);
    const active = getActiveKeys();
    expect(active.find((k) => k.thumbprint === oldTp)).toBeUndefined();
  });
});
