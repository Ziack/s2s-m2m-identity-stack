import { describe, it, expect, beforeAll } from 'vitest';
import { decodeProtectedHeader, decodeJwt, jwtVerify, importJWK } from 'jose';
import { createHash } from 'node:crypto';
import { initKeyPair, getPublicJwk, _resetKeyManagerForTest } from '../../src/dpop/keyManager.js';
import { signDPoP } from '../../src/dpop/signDPoP.js';

describe('signDPoP', () => {
  beforeAll(async () => {
    _resetKeyManagerForTest();
    await initKeyPair();
  });

  it('produces a JWS with header typ=dpop+jwt and alg=ES256 and embedded jwk', async () => {
    const { proof, jti } = await signDPoP({ accessToken: 'tok', htm: 'POST', htu: 'https://api.example/v1/x' });
    const header = decodeProtectedHeader(proof);
    expect(header.typ).toBe('dpop+jwt');
    expect(header.alg).toBe('ES256');
    expect(header.jwk).toEqual(getPublicJwk());
    const payload = decodeJwt(proof);
    expect(payload.htm).toBe('POST');
    expect(payload.htu).toBe('https://api.example/v1/x');
    expect(payload.jti).toBe(jti);
    expect(typeof payload.iat).toBe('number');
    expect(payload.ath).toBe(createHash('sha256').update('tok').digest('base64url'));
  });

  it('signature verifies with the embedded jwk', async () => {
    const { proof } = await signDPoP({ accessToken: 't', htm: 'GET', htu: 'https://api.example/v1/y' });
    const header = decodeProtectedHeader(proof);
    const key = await importJWK(header.jwk as Record<string, unknown>, 'ES256');
    const { payload } = await jwtVerify(proof, key);
    expect(payload.htm).toBe('GET');
  });

  it('generates a fresh jti per call (UUID v4 shape)', async () => {
    const a = await signDPoP({ accessToken: 't', htm: 'GET', htu: 'https://api.example/v1' });
    const b = await signDPoP({ accessToken: 't', htm: 'GET', htu: 'https://api.example/v1' });
    expect(a.jti).not.toBe(b.jti);
    expect(a.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
