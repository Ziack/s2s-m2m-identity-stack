import type { JWK } from 'jose';

export interface JwksManagerOptions {
  jwksUri: string;
  refreshHours: number;
  fetchImpl?: typeof fetch;
  nowFn?: () => number;
}

export interface JwksManager {
  getKeys(opts?: { forceRefresh?: boolean }): Promise<JWK[]>;
}

// Module-level last-refresh tracker. Multiple JwksManager instances coexist
// (one per issuer) but the example-services health probe only needs the most
// recent successful refresh across all of them. Exposed via jwksLastRefreshAt().
let _lastRefreshAtMs: number | null = null;

/**
 * Health probe — returns the UNIX-ms timestamp of the most recent successful
 * JWKS refresh, or null if no refresh has occurred yet. Consumed by example
 * services for `/health/auth` to detect stale signing-key caches.
 */
export function jwksLastRefreshAt(): number | null {
  return _lastRefreshAtMs;
}

/** Test-only reset hook. */
export function _resetJwksLastRefreshForTest(): void {
  _lastRefreshAtMs = null;
}

export function createJwksManager(opts: JwksManagerOptions): JwksManager {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.nowFn ?? Date.now;
  let cached: JWK[] | null = null;
  let cachedAtMs = 0;
  const ttlMs = opts.refreshHours * 3600 * 1000;

  async function fetchOnce(): Promise<JWK[]> {
    const res = await fetchImpl(opts.jwksUri, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const json = (await res.json()) as { keys: JWK[] };
    cached = json.keys;
    cachedAtMs = now();
    _lastRefreshAtMs = cachedAtMs;
    return cached;
  }

  return {
    async getKeys(o?: { forceRefresh?: boolean }) {
      if (!cached || o?.forceRefresh || now() - cachedAtMs > ttlMs) {
        return fetchOnce();
      }
      return cached;
    },
  };
}
