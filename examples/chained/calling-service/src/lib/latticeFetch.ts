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
 * Transport split: `useLattice()` gates ONLY the data-plane hop (calling →
 * receiving). The control-plane broker token-exchange always uses the broker's
 * ALB endpoint with `client_secret_basic` regardless of this gate, because SigV4
 * and `client_secret_basic` both own the `Authorization` header and cannot
 * coexist on one request (see exchangeClient.ts).
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
