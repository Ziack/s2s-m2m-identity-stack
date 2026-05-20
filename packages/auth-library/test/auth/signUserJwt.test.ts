import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, jwtVerify, decodeJwt, type KeyLike } from 'jose';
import { signUserJwt } from '../../src/auth/signUserJwt.js';

describe('signUserJwt', () => {
  let privateKey: KeyLike;
  let publicKey: KeyLike;

  beforeAll(async () => {
    const kp = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    privateKey = kp.privateKey;
    publicKey = kp.publicKey;
  });

  it('produces a JWT verifiable with the matching public key', async () => {
    const token = await signUserJwt(
      {
        privateKey,
        kid: 'local-1',
        issuer: 'https://calling-service/auth',
        audience: 'calling-service',
        ttlSeconds: 900,
      },
      { sub: 'user-alice' },
    );
    const { payload, protectedHeader } = await jwtVerify(token, publicKey);
    expect(protectedHeader.alg).toBe('RS256');
    expect(protectedHeader.kid).toBe('local-1');
    expect(payload.sub).toBe('user-alice');
    expect(payload.iss).toBe('https://calling-service/auth');
    expect(payload.aud).toBe('calling-service');
  });

  it('sets iss, aud, sub, roles, groups, iat, exp, jti', async () => {
    const NOW_MS = 1_700_000_000_000;
    const token = await signUserJwt(
      {
        privateKey,
        kid: 'k1',
        issuer: 'https://issuer',
        audience: 'aud-a',
        ttlSeconds: 600,
      },
      {
        sub: 'user-x',
        roles: ['admin', 'reader'],
        groups: ['eng'],
        nowFn: () => NOW_MS,
      },
    );
    const claims = decodeJwt(token) as Record<string, unknown>;
    expect(claims.iss).toBe('https://issuer');
    expect(claims.aud).toBe('aud-a');
    expect(claims.sub).toBe('user-x');
    expect(claims.roles).toEqual(['admin', 'reader']);
    expect(claims.groups).toEqual(['eng']);
    expect(claims.iat).toBe(Math.floor(NOW_MS / 1000));
    expect(claims.exp).toBe(Math.floor(NOW_MS / 1000) + 600);
    expect(typeof claims.jti).toBe('string');
    expect((claims.jti as string).length).toBeGreaterThan(0);
  });

  it('applies ttlSeconds correctly', async () => {
    const NOW_MS = 1_700_000_000_000;
    const token = await signUserJwt(
      {
        privateKey,
        kid: 'k1',
        issuer: 'iss',
        audience: 'aud',
        ttlSeconds: 1234,
      },
      { sub: 'u', nowFn: () => NOW_MS },
    );
    const claims = decodeJwt(token);
    expect((claims.exp as number) - (claims.iat as number)).toBe(1234);
  });

  it('merges custom claims at the top level and drops reserved keys', async () => {
    const token = await signUserJwt(
      { privateKey, kid: 'k1', issuer: 'iss', audience: 'aud' },
      {
        sub: 'u',
        customClaims: {
          email: 'a@b.com',
          tenant: 't1',
          // Attempt to overwrite reserved claims — must be ignored.
          iss: 'attacker',
          sub: 'evil',
          exp: 0,
        },
      },
    );
    const claims = decodeJwt(token) as Record<string, unknown>;
    expect(claims.email).toBe('a@b.com');
    expect(claims.tenant).toBe('t1');
    expect(claims.iss).toBe('iss');
    expect(claims.sub).toBe('u');
    expect(typeof claims.exp).toBe('number');
    expect(claims.exp).not.toBe(0);
  });

  it('produces a different jti on each call', async () => {
    const opts = { privateKey, kid: 'k1', issuer: 'iss', audience: 'aud' } as const;
    const t1 = await signUserJwt(opts, { sub: 'u' });
    const t2 = await signUserJwt(opts, { sub: 'u' });
    expect((decodeJwt(t1) as { jti: string }).jti).not.toBe((decodeJwt(t2) as { jti: string }).jti);
  });
});
