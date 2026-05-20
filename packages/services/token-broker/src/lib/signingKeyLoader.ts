import { importPKCS8, exportJWK, calculateJwkThumbprint, type KeyLike, type JWK } from 'jose';
import { getClientSecret, invalidateClientSecret } from '@s2s/auth-library';

export interface LoadedSigningKey {
  /** PKCS8-imported private key for signing. */
  privateKey: KeyLike;
  /** Public JWK (with kid/use/alg populated) for the JWKS endpoint. */
  publicJwk: JWK & { kid: string; use: 'sig'; alg: 'RS256' };
  /** Key ID — RFC 7638 thumbprint of the public JWK. */
  kid: string;
  /** Unix-ms timestamp this key was loaded. */
  loadedAtMs: number;
}

export interface SigningKeyLoaderOptions {
  secretArn: string;
  region?: string;
  /** Cache TTL ms (default 1h). */
  ttlMs?: number;
  /** Injectable clock. */
  nowFn?: () => number;
  /** Override the secret fetcher (tests). */
  fetchSecret?: (arn: string) => Promise<string>;
}

export interface SigningKeyLoader {
  /** Returns a loaded key, refreshing if cache is stale. */
  get(): Promise<LoadedSigningKey>;
  /** Force-evict the cache (also clears underlying secrets cache). */
  invalidate(): void;
}

const DEFAULT_TTL_MS = 3_600_000;

export function createSigningKeyLoader(opts: SigningKeyLoaderOptions): SigningKeyLoader {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.nowFn ?? Date.now;
  let cached: LoadedSigningKey | null = null;

  async function fetchPem(): Promise<string> {
    if (opts.fetchSecret) return opts.fetchSecret(opts.secretArn);
    const fetcherOpts: { region?: string } = {};
    if (opts.region !== undefined) fetcherOpts.region = opts.region;
    return getClientSecret(opts.secretArn, fetcherOpts);
  }

  async function load(): Promise<LoadedSigningKey> {
    const pem = await fetchPem();
    const trimmed = pem.trim();
    if (!trimmed.startsWith('-----BEGIN')) {
      throw new Error('signing key secret is not a PEM-encoded PKCS8 private key');
    }
    const privateKey = await importPKCS8(trimmed, 'RS256', { extractable: true });
    const jwk = await exportJWK(privateKey);
    if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string' || typeof jwk.kty !== 'string') {
      throw new Error('exported JWK is missing required RSA public components');
    }
    // Strip private components to compute thumbprint on the public JWK.
    const publicJwk: JWK = { kty: jwk.kty, n: jwk.n, e: jwk.e };
    const kid = await calculateJwkThumbprint(publicJwk, 'sha256');
    const loaded: LoadedSigningKey = {
      privateKey,
      publicJwk: { ...publicJwk, kid, use: 'sig', alg: 'RS256' } as JWK & {
        kid: string;
        use: 'sig';
        alg: 'RS256';
      },
      kid,
      loadedAtMs: now(),
    };
    return loaded;
  }

  return {
    async get() {
      if (cached && now() - cached.loadedAtMs < ttlMs) return cached;
      cached = await load();
      return cached;
    },
    invalidate() {
      cached = null;
      if (!opts.fetchSecret) invalidateClientSecret(opts.secretArn);
    },
  };
}
