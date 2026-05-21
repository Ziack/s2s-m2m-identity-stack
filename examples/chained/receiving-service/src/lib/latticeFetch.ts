/**
 * Phase 4 (Job C): outbound transport selection for the receiving-service.
 *
 * Mirrors the calling-service helper. Two transports:
 *   - **ALB / plain fetch** — legacy. DPoP-bound token in `Authorization: DPoP`.
 *   - **VPC Lattice + SigV4** — `createLatticeFetch` SigV4-signs `Authorization`,
 *     so the DPoP-bound access token moves to `X-DPoP-Token` (`DPOP_TOKEN_HEADER`)
 *     and the DPoP proof stays in `DPoP` (its `htu` binds to the Lattice URL).
 *
 * `useLattice()` centralises the gate so both the ledger call and the broker
 * token-exchange make the same transport decision.
 */
import { createLatticeFetch, DPOP_TOKEN_HEADER, type LatticeFetchFn } from '@s2s/auth-library';

/** True when the service should route outbound calls over VPC Lattice + SigV4. */
export function useLattice(): boolean {
  return (process.env.USE_LATTICE ?? '').toLowerCase() === 'true';
}

let latticeFetchFn: LatticeFetchFn | null = null;

/** Test seam — inject a fake LatticeFetchFn. */
export function __setLatticeFetchForTest(fn: LatticeFetchFn | null): void {
  latticeFetchFn = fn;
}

export function getLatticeFetch(region: string): LatticeFetchFn {
  if (!latticeFetchFn) {
    latticeFetchFn = createLatticeFetch({ region });
  }
  return latticeFetchFn;
}

/**
 * A `typeof fetch`-shaped adapter over {@link createLatticeFetch}, suitable for
 * passing as `fetchImpl` to SDK factories such as `createExchangeToken`.
 *
 * Relocates a `DPoP|Bearer` Authorization token into `X-DPoP-Token` before
 * signing; a `Basic` credential (broker `client_secret_basic`) is left in place
 * — SigV4 overwrites it (see the broker-auth note in the Phase 4 report).
 */
export function latticeFetchAdapter(region: string): typeof fetch {
  const sign = getLatticeFetch(region);
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url;
    const method = (init?.method ?? 'GET').toUpperCase();

    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => { headers[key] = value; });
    }

    const auth = headers['authorization'] ?? headers['Authorization'];
    if (auth) {
      const m = auth.match(/^(?:DPoP|Bearer)\s+(.+)$/i);
      if (m) {
        delete headers['authorization'];
        delete headers['Authorization'];
        headers[DPOP_TOKEN_HEADER] = m[1] as string;
      }
    }

    const body = typeof init?.body === 'string' ? init.body : undefined;
    return sign({ url, method, headers, ...(body !== undefined ? { body } : {}) });
  }) as typeof fetch;
}
