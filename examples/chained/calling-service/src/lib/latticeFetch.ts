/**
 * Phase 4 (Job C): outbound transport selection for the calling-service.
 *
 * Two transports:
 *   - **ALB / plain fetch** — the legacy path. Used when Lattice is disabled
 *     (`USE_LATTICE` unset/false or no callee Lattice DNS). DPoP-bound access
 *     token rides in `Authorization: DPoP <token>` exactly as before.
 *   - **VPC Lattice + SigV4** — the new path. The network hop is authenticated
 *     by SigV4 IAM (`createLatticeFetch` signs `Authorization`), so the
 *     DPoP-bound access token moves to the `X-DPoP-Token` header
 *     (`DPOP_TOKEN_HEADER`). The DPoP proof stays in `DPoP`; its `htu` must bind
 *     to the Lattice DNS URL (callers pass the Lattice URL as `htu`).
 *
 * `useLattice()` centralises the gate so both the receiving-service call and the
 * broker token-exchange make the same transport decision.
 */
import { createLatticeFetch, DPOP_TOKEN_HEADER, type LatticeFetchFn } from '@s2s/auth-library';
import type { CallingServiceConfig } from '../config.js';

/** True when the service should route outbound calls over VPC Lattice + SigV4. */
export function useLattice(): boolean {
  return (process.env.USE_LATTICE ?? '').toLowerCase() === 'true';
}

let latticeFetchFn: LatticeFetchFn | null = null;

/** Test seam — inject a fake LatticeFetchFn. */
export function __setLatticeFetchForTest(fn: LatticeFetchFn | null): void {
  latticeFetchFn = fn;
}

function getLatticeFetch(region: string): LatticeFetchFn {
  if (!latticeFetchFn) {
    latticeFetchFn = createLatticeFetch({ region });
  }
  return latticeFetchFn;
}

/**
 * A `typeof fetch`-shaped adapter over {@link createLatticeFetch}, suitable for
 * passing as `fetchImpl` to SDK factories such as `createExchangeToken`.
 *
 * Header relocation: if the caller set `Authorization: DPoP|Bearer <token>`, the
 * token is moved to `X-DPoP-Token` before signing (so SigV4 can own
 * `Authorization`). A `Basic` credential (broker `client_secret_basic`) is left
 * in place — SigV4 will overwrite it; see the broker-auth note in the Phase 4
 * report.
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

    // Relocate a DPoP/Bearer access token off Authorization into X-DPoP-Token.
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

/**
 * Send a single DPoP-authenticated POST to a downstream s2s service.
 *
 * In Lattice mode the access token goes in `X-DPoP-Token` and the request is
 * SigV4-signed; otherwise it falls back to plain fetch with
 * `Authorization: DPoP <token>`.
 */
export async function postDownstream(args: {
  config: CallingServiceConfig;
  url: string;
  accessToken: string;
  dpopProof: string;
  body: string;
  extraHeaders?: Record<string, string>;
}): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    'dpop': args.dpopProof,
    'content-type': 'application/json',
    ...args.extraHeaders,
  };

  if (useLattice()) {
    const sign = getLatticeFetch(args.config.awsRegion);
    return sign({
      url: args.url,
      method: 'POST',
      headers: { ...baseHeaders, [DPOP_TOKEN_HEADER]: args.accessToken },
      body: args.body,
    });
  }

  return fetch(args.url, {
    method: 'POST',
    headers: { ...baseHeaders, 'authorization': `DPoP ${args.accessToken}` },
    body: args.body,
  });
}
