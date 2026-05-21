/**
 * Loads the user-issuer RSA private key for the local IdP.
 *
 * Production path: read a PEM-encoded PKCS8 RSA private key from AWS Secrets
 * Manager (ARN supplied by `USER_ISSUER_SIGNING_KEY_SECRET_ARN`), cache for
 * 1 hour, expose RFC 7638 thumbprint as `kid`.
 *
 * Dev/test path: if `USER_ISSUER_DEV_KEY_PEM` is set the loader bypasses
 * Secrets Manager and uses the env value directly.
 *
 * WARNING: `USER_ISSUER_DEV_KEY_PEM` is for local development and unit tests
 * ONLY. Never set this env in production — it puts a private key in the
 * process environment where it can leak via crash dumps or child processes.
 *
 * This file disappears entirely when Keycloak takes over the IdP role.
 */
import { importPKCS8, exportJWK, calculateJwkThumbprint, type KeyLike, type JWK } from 'jose';
import { getClientSecret, invalidateClientSecret } from '@s2s/auth-library';

export interface LoadedUserIssuerKey {
  privateKey: KeyLike;
  publicJwk: JWK & { kid: string; use: 'sig'; alg: 'RS256' };
  kid: string;
  loadedAtMs: number;
}

export interface UserIssuerKeyLoaderOptions {
  /** Secrets Manager ARN for the PEM-encoded PKCS8 RSA private key. */
  secretArn?: string;
  /** Optional dev override (PEM body). Bypasses Secrets Manager entirely. */
  devKeyPem?: string;
  region?: string;
  /** Cache TTL ms (default 1h). */
  ttlMs?: number;
  nowFn?: () => number;
  /** Test hook: replace the Secrets Manager fetch. */
  fetchSecret?: (arn: string) => Promise<string>;
}

export interface UserIssuerKeyLoader {
  get(): Promise<LoadedUserIssuerKey>;
  invalidate(): void;
}

const DEFAULT_TTL_MS = 3_600_000;

export function createUserIssuerKeyLoader(opts: UserIssuerKeyLoaderOptions): UserIssuerKeyLoader {
  if (!opts.secretArn && !opts.devKeyPem) {
    throw new Error('createUserIssuerKeyLoader: one of secretArn or devKeyPem is required');
  }
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.nowFn ?? Date.now;
  let cached: LoadedUserIssuerKey | null = null;

  async function fetchPem(): Promise<string> {
    if (opts.devKeyPem) return opts.devKeyPem;
    if (opts.fetchSecret && opts.secretArn) return opts.fetchSecret(opts.secretArn);
    const fetcherOpts: { region?: string } = {};
    if (opts.region !== undefined) fetcherOpts.region = opts.region;
    return getClientSecret(opts.secretArn as string, fetcherOpts);
  }

  async function load(): Promise<LoadedUserIssuerKey> {
    const pem = await fetchPem();
    const trimmed = pem.trim();
    if (!trimmed.startsWith('-----BEGIN')) {
      throw new Error('user-issuer signing key is not a PEM-encoded PKCS8 private key');
    }
    const privateKey = await importPKCS8(trimmed, 'RS256', { extractable: true });
    const jwk = await exportJWK(privateKey);
    if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string' || typeof jwk.kty !== 'string') {
      throw new Error('exported user-issuer JWK is missing required RSA public components');
    }
    const publicJwkBase: JWK = { kty: jwk.kty, n: jwk.n, e: jwk.e };
    const kid = await calculateJwkThumbprint(publicJwkBase, 'sha256');
    return {
      privateKey,
      publicJwk: { ...publicJwkBase, kid, use: 'sig', alg: 'RS256' } as JWK & {
        kid: string;
        use: 'sig';
        alg: 'RS256';
      },
      kid,
      loadedAtMs: now(),
    };
  }

  return {
    async get() {
      if (cached && now() - cached.loadedAtMs < ttlMs) return cached;
      cached = await load();
      return cached;
    },
    invalidate() {
      cached = null;
      if (!opts.devKeyPem && !opts.fetchSecret && opts.secretArn) {
        invalidateClientSecret(opts.secretArn);
      }
    },
  };
}
