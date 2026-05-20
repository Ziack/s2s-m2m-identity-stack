import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { createValidateUserToken } from '../../src/auth/validateUserToken.js';
import { AuthError } from '../../src/errors.js';

describe('validateUserToken', () => {
  let signer: Awaited<ReturnType<typeof generateKeyPair>>;
  let publicJwk: Record<string, unknown>;
  let validate: ReturnType<typeof createValidateUserToken>;

  const NOW_MS = 1_700_000_000_000;
  const NOW_SEC = Math.floor(NOW_MS / 1000);

  beforeAll(async () => {
    signer = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    publicJwk = { ...(await exportJWK(signer.publicKey)), kid: 'u1', alg: 'RS256', use: 'sig' };
    const jwksManager = { getKeys: async () => [publicJwk as never] };
    validate = createValidateUserToken({
      jwksManager,
      expectedIssuer: 'https://user-issuer',
      expectedAudience: 'entrypoint-service',
      nowFn: () => NOW_MS,
    });
  });

  async function makeToken(claims: Record<string, unknown>): Promise<string> {
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'u1' }).sign(signer.privateKey);
  }

  it('returns UserContext with sub, roles, groups, claims, issuer (happy path)', async () => {
    const token = await makeToken({
      sub: 'user-alice',
      iss: 'https://user-issuer',
      aud: 'entrypoint-service',
      exp: NOW_SEC + 1000,
      iat: NOW_SEC,
      roles: ['admin', 'reader'],
      groups: ['eng', 'ops'],
      email: 'alice@example.com',
      department: 'platform',
    });
    const r = await validate({ token });
    expect(r.sub).toBe('user-alice');
    expect(r.roles).toEqual(['admin', 'reader']);
    expect(r.groups).toEqual(['eng', 'ops']);
    expect(r.issuer).toBe('https://user-issuer');
    expect(r.claims.email).toBe('alice@example.com');
    expect(r.claims.department).toBe('platform');
    // Reserved claims should not be present in `claims`.
    expect(r.claims.iss).toBeUndefined();
    expect(r.claims.sub).toBeUndefined();
    expect(r.claims.roles).toBeUndefined();
  });

  it('rejects expired token with TOKEN_EXPIRED', async () => {
    const token = await makeToken({
      sub: 'u',
      iss: 'https://user-issuer',
      aud: 'entrypoint-service',
      exp: NOW_SEC - 100,
      iat: NOW_SEC - 1000,
    });
    await expect(validate({ token })).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('rejects wrong issuer with INVALID_TOKEN', async () => {
    const token = await makeToken({
      sub: 'u',
      iss: 'https://attacker',
      aud: 'entrypoint-service',
      exp: NOW_SEC + 1000,
      iat: NOW_SEC,
    });
    await expect(validate({ token })).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('rejects wrong audience with INVALID_AUDIENCE', async () => {
    const token = await makeToken({
      sub: 'u',
      iss: 'https://user-issuer',
      aud: 'other-service',
      exp: NOW_SEC + 1000,
      iat: NOW_SEC,
    });
    await expect(validate({ token })).rejects.toMatchObject({ code: 'invalid_audience' });
  });

  it('parses string-form roles `"admin reader"` into an array', async () => {
    const token = await makeToken({
      sub: 'u',
      iss: 'https://user-issuer',
      aud: 'entrypoint-service',
      exp: NOW_SEC + 1000,
      iat: NOW_SEC,
      roles: 'admin reader',
    });
    const r = await validate({ token });
    expect(r.roles).toEqual(['admin', 'reader']);
  });

  it('returns empty roles array when claim is missing (not an error)', async () => {
    const token = await makeToken({
      sub: 'u',
      iss: 'https://user-issuer',
      aud: 'entrypoint-service',
      exp: NOW_SEC + 1000,
      iat: NOW_SEC,
    });
    const r = await validate({ token });
    expect(r.roles).toEqual([]);
    expect(r.groups).toEqual([]);
  });

  it('accepts array-form audience that includes expectedAudience', async () => {
    const token = await makeToken({
      sub: 'u',
      iss: 'https://user-issuer',
      aud: ['entrypoint-service', 'other'],
      exp: NOW_SEC + 1000,
      iat: NOW_SEC,
    });
    const r = await validate({ token });
    expect(r.sub).toBe('u');
  });

  it('auto-refreshes JWKS once on signature failure and succeeds', async () => {
    const realSigner = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const realPublicJwk = { ...(await exportJWK(realSigner.publicKey)), kid: 'u1', alg: 'RS256', use: 'sig' };
    const staleSigner = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const stalePublicJwk = { ...(await exportJWK(staleSigner.publicKey)), kid: 'u1', alg: 'RS256', use: 'sig' };

    let forceRefreshCount = 0;
    const jwksManager = {
      async getKeys(o?: { forceRefresh?: boolean }): Promise<Record<string, unknown>[]> {
        if (o?.forceRefresh) {
          forceRefreshCount++;
          return [realPublicJwk];
        }
        return [stalePublicJwk];
      },
    };

    const v = createValidateUserToken({
      jwksManager,
      expectedIssuer: 'https://user-issuer',
      expectedAudience: 'entrypoint-service',
      nowFn: () => NOW_MS,
    });

    const token = await new SignJWT({
      sub: 'u',
      iss: 'https://user-issuer',
      aud: 'entrypoint-service',
      exp: NOW_SEC + 1000,
      iat: NOW_SEC,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'u1' })
      .sign(realSigner.privateKey);

    const r = await v({ token });
    expect(r.sub).toBe('u');
    expect(forceRefreshCount).toBe(1);
  });

  it('does not loop forever when refreshed JWKS still cannot verify', async () => {
    const staleSigner = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const stalePublicJwk = { ...(await exportJWK(staleSigner.publicKey)), kid: 'u1', alg: 'RS256', use: 'sig' };
    let forceRefreshCount = 0;
    const jwksManager = {
      async getKeys(o?: { forceRefresh?: boolean }): Promise<Record<string, unknown>[]> {
        if (o?.forceRefresh) forceRefreshCount++;
        return [stalePublicJwk];
      },
    };
    const v = createValidateUserToken({
      jwksManager,
      expectedIssuer: 'https://user-issuer',
      expectedAudience: 'entrypoint-service',
      nowFn: () => NOW_MS,
    });
    const realSigner = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const token = await new SignJWT({
      sub: 'u',
      iss: 'https://user-issuer',
      aud: 'entrypoint-service',
      exp: NOW_SEC + 1000,
      iat: NOW_SEC,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'u1' })
      .sign(realSigner.privateKey);

    await expect(v({ token })).rejects.toBeInstanceOf(AuthError);
    expect(forceRefreshCount).toBe(1);
  });
});
