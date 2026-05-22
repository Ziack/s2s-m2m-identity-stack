import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { createValidateToken } from '../../src/validation/validateToken.js';
import { AuthError } from '../../src/errors.js';

describe('validateToken', () => {
  let signer: Awaited<ReturnType<typeof generateKeyPair>>;
  let publicJwk: Record<string, unknown>;
  let validate: ReturnType<typeof createValidateToken>;

  beforeAll(async () => {
    signer = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    publicJwk = { ...(await exportJWK(signer.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const jwksManager = { getKeys: async () => [publicJwk as never] };
    validate = createValidateToken({ jwksManager, expectedIssuer: 'https://issuer', nowFn: () => 1_700_000_000_000 });
  });

  async function makeToken(claims: Record<string, unknown>): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .sign(signer.privateKey);
  }

  it('accepts a valid token and returns parsed fields', async () => {
    const token = await makeToken({ sub: 'client-1', scope: 'a b', aud: 'res-x', iss: 'https://issuer', exp: 1_700_000_000 + 1000, iat: 1_700_000_000 });
    const r = await validate(token, { expectedAudience: 'res-x' });
    expect(r.sub).toBe('client-1');
    expect(r.scope).toEqual(['a', 'b']);
    expect(r.aud).toBe('res-x');
  });

  it('exposes the cnf claim (RFC 9449 sender constraint) from a broker-style token', async () => {
    const token = await makeToken({
      sub: 'svc-a',
      scope: 'a',
      aud: 'res-x',
      iss: 'https://issuer',
      exp: 1_700_000_000 + 1000,
      iat: 1_700_000_000,
      cnf: { jkt: 'abc123-thumbprint' },
    });
    const r = await validate(token, { expectedAudience: 'res-x' });
    expect(r.cnf).toEqual({ jkt: 'abc123-thumbprint' });
    expect(r.cnf?.jkt).toBe('abc123-thumbprint');
  });

  it('leaves cnf undefined on a token without a confirmation claim', async () => {
    const token = await makeToken({
      sub: 'svc-a',
      scope: 'a',
      aud: 'res-x',
      iss: 'https://issuer',
      exp: 1_700_000_000 + 1000,
      iat: 1_700_000_000,
    });
    const r = await validate(token, { expectedAudience: 'res-x' });
    expect(r.cnf).toBeUndefined();
  });

  it('rejects expired token', async () => {
    const token = await makeToken({ sub: 'c', scope: 'a', aud: 'r', iss: 'https://issuer', exp: 1_500_000_000, iat: 1_400_000_000 });
    await expect(validate(token, { expectedAudience: 'r' })).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('rejects wrong audience', async () => {
    const token = await makeToken({ sub: 'c', scope: 'a', aud: 'other', iss: 'https://issuer', exp: 1_700_000_000 + 1000, iat: 1_700_000_000 });
    await expect(validate(token, { expectedAudience: 'r' })).rejects.toMatchObject({ code: 'invalid_audience' });
  });

  it('rejects bad signature', async () => {
    const token = (await makeToken({ sub: 'c', scope: 'a', aud: 'r', iss: 'https://issuer', exp: 1_700_000_000 + 1000, iat: 1_700_000_000 })) + 'x';
    await expect(validate(token, { expectedAudience: 'r' })).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('auto-refreshes JWKS once on signature-verification failure and succeeds', async () => {
    // Generate a second signer that will be the "current" key after refresh.
    const realSigner = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const realPublicJwk = { ...(await exportJWK(realSigner.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

    // Stale signer (different key material, same kid) — will fail verification.
    const staleSigner = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const stalePublicJwk = { ...(await exportJWK(staleSigner.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

    let forceRefreshCount = 0;
    let getKeysCount = 0;
    const jwksManager = {
      async getKeys(opts?: { forceRefresh?: boolean }): Promise<Record<string, unknown>[]> {
        getKeysCount++;
        if (opts?.forceRefresh) {
          forceRefreshCount++;
          return [realPublicJwk];
        }
        return [stalePublicJwk];
      },
    };

    const v = createValidateToken({
      jwksManager,
      expectedIssuer: 'https://issuer',
      nowFn: () => 1_700_000_000_000,
    });

    // Token signed by the REAL (current) key, but JWKS cache returns the stale key first.
    const token = await new SignJWT({
      sub: 'client-1',
      scope: 'a',
      aud: 'res-x',
      iss: 'https://issuer',
      exp: 1_700_000_000 + 1000,
      iat: 1_700_000_000,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .sign(realSigner.privateKey);

    const result = await v(token, { expectedAudience: 'res-x' });
    expect(result.sub).toBe('client-1');
    expect(forceRefreshCount).toBe(1);
    // First call (no force) + one forced refresh.
    expect(getKeysCount).toBe(2);
  });

  it('does not infinite-loop when refreshed JWKS still cannot verify', async () => {
    const staleSigner = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const stalePublicJwk = { ...(await exportJWK(staleSigner.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

    let forceRefreshCount = 0;
    const jwksManager = {
      async getKeys(opts?: { forceRefresh?: boolean }): Promise<Record<string, unknown>[]> {
        if (opts?.forceRefresh) forceRefreshCount++;
        return [stalePublicJwk];
      },
    };

    const v = createValidateToken({
      jwksManager,
      expectedIssuer: 'https://issuer',
      nowFn: () => 1_700_000_000_000,
    });

    const realSigner = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const token = await new SignJWT({
      sub: 'c', scope: 'a', aud: 'r', iss: 'https://issuer', exp: 1_700_000_000 + 1000, iat: 1_700_000_000,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .sign(realSigner.privateKey);

    await expect(v(token, { expectedAudience: 'r' })).rejects.toBeInstanceOf(AuthError);
    expect(forceRefreshCount).toBe(1);
  });
});
