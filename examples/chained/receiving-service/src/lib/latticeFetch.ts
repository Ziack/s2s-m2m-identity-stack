/**
 * Phase 4 (Job C): outbound transport selection for the receiving-service.
 *
 * Mirrors the calling-service helper. Two transports:
 *   - **ALB / plain fetch** — legacy. DPoP-bound token in `Authorization: DPoP`.
 *   - **VPC Lattice + SigV4** — `createLatticeFetch` SigV4-signs `Authorization`,
 *     so the DPoP-bound access token moves to `X-DPoP-Token` (`DPOP_TOKEN_HEADER`)
 *     and the DPoP proof stays in `DPoP` (its `htu` binds to the Lattice URL).
 *
 * Transport split: `useLattice()` gates ONLY the data-plane hop (receiving →
 * ledger). The control-plane broker token-exchange always uses the broker's ALB
 * endpoint with `client_secret_basic` regardless of this gate, because SigV4 and
 * `client_secret_basic` both own the `Authorization` header and cannot coexist
 * on one request (see ledgerClient.ts).
 */
import { createLatticeFetch, type LatticeFetchFn } from '@s2s/auth-library';

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
