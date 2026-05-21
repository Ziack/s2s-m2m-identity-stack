import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportPKCS8, jwtVerify, importJWK } from 'jose';
import { createUserIssuerKeyLoader } from '../../src/auth/userIssuerKeyLoader.js';
import { createLocalIssuer } from '../../src/auth/localIssuer.js';
import { AuthError } from '@s2s/auth-library';

let pem: string;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  pem = await exportPKCS8(kp.privateKey);
});

function buildIssuer() {
  const loader = createUserIssuerKeyLoader({ devKeyPem: pem });
  const issuer = createLocalIssuer({
    issuer: 'http://test/auth',
    audience: 'calling-service',
    keyLoader: loader,
  });
  return { issuer, loader };
}

describe('localIssuer.issueUserToken', () => {
  it('mints a valid JWT for a known user that verifies against the published JWK', async () => {
    const { issuer, loader } = buildIssuer();
    const res = await issuer.issueUserToken({ username: 'alice', password: 'alice-pw' });

    expect(res.sub).toBe('user-alice');
    expect(res.roles).toContain('loan-officer');
    expect(res.expires_in).toBe(900);
    expect(typeof res.user_token).toBe('string');

    const key = await loader.get();
    const pub = await importJWK(key.publicJwk, 'RS256');
    const v = await jwtVerify(res.user_token, pub);
    expect(v.payload.sub).toBe('user-alice');
    expect(v.payload.iss).toBe('http://test/auth');
    expect(v.payload.aud).toBe('calling-service');
    expect(v.payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect((v.payload as { roles?: string[] }).roles).toEqual(['loan-officer', 'reader']);
    expect((v.payload as { groups?: string[] }).groups).toEqual(['retail-banking']);
  });

  it('throws 401 INVALID_TOKEN on wrong password', async () => {
    const { issuer } = buildIssuer();
    await expect(issuer.issueUserToken({ username: 'alice', password: 'nope' })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
  });

  it('throws 401 on unknown user', async () => {
    const { issuer } = buildIssuer();
    await expect(issuer.issueUserToken({ username: 'mallory', password: 'x' })).rejects.toBeInstanceOf(AuthError);
  });
});
