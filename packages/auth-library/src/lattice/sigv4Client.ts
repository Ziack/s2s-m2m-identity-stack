import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { HttpRequest } from '@smithy/protocol-http';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';

/**
 * Default AWS service name for VPC Lattice SigV4 signing.
 *
 * When a Lattice service network / service uses `auth_type = AWS_IAM`, the
 * dataplane authenticates inbound requests as SigV4 calls against the
 * `vpc-lattice-svcs` service. The signing region is the region the Lattice
 * service lives in.
 */
export const LATTICE_SIGNING_SERVICE = 'vpc-lattice-svcs';

/**
 * Header that carries the DPoP-bound *access token* across the Lattice hop.
 *
 * ── Why this exists (the Authorization-header collision) ─────────────────────
 * VPC Lattice IAM auth (`AWS_IAM`) is implemented as SigV4 over the *standard*
 * HTTP `Authorization` header (`Authorization: AWS4-HMAC-SHA256 ...`). Our app
 * layer ALSO wants the `Authorization` header for the RFC 9449 DPoP-bound access
 * token (`Authorization: DPoP <token>`). Both cannot occupy `Authorization`.
 *
 * Crucially, VPC Lattice does NOT strip or rewrite the SigV4 `Authorization`
 * header before forwarding to the target: the dataplane validates the SigV4
 * signature for IAM auth, then proxies the request — Authorization, X-Amz-Date,
 * X-Amz-Security-Token and all — through to the receiving service essentially
 * unchanged. (Lattice adds its own `x-amzn-*` identity headers; it does not
 * remove the caller's Authorization.) That means a receiver reading the DPoP
 * access token from `Authorization` would instead find the SigV4 credential
 * scope string, and DPoP verification would fail.
 *
 * Resolution: SigV4 owns `Authorization`. The DPoP access token rides in this
 * dedicated `X-DPoP-Token` header, and the DPoP *proof* stays in the existing
 * `DPoP` header (the proof's `htu`/`htm` already bind it to the request, so it
 * is unaffected by the move). Receiving middleware must read the access token
 * from `X-DPoP-Token` when present, falling back to `Authorization: DPoP` for
 * non-Lattice (direct) callers.
 *
 * This factory does NOT inject the DPoP token itself — callers pass whatever
 * headers they want (including `X-DPoP-Token` and `DPoP`) via
 * `LatticeRequestInput.headers`; this client only adds the SigV4 layer on top.
 * The constant is exported so callers and receiver middleware share one source
 * of truth for the header name.
 */
export const DPOP_TOKEN_HEADER = 'X-DPoP-Token';

export interface LatticeFetchOptions {
  /** AWS region of the target Lattice service (used as the SigV4 signing region). */
  region: string;
  /** SigV4 service name. Defaults to {@link LATTICE_SIGNING_SERVICE}. */
  service?: string;
  /**
   * Credential provider used to sign. Defaults to {@link fromNodeProviderChain},
   * which resolves the ambient task-role credentials (ECS/EKS container creds,
   * EC2 IMDS, env vars, …) — i.e. the caller's task role.
   */
  credentials?: AwsCredentialIdentityProvider;
  /** Injectable fetch implementation (for tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface LatticeRequestInput {
  /** Full Lattice service URL, e.g. `https://my-svc-0a1b.7d67968.vpc-lattice-svcs.us-east-1.on.aws/v1/things`. */
  url: string;
  /** HTTP method (GET/POST/…). */
  method: string;
  /**
   * Extra headers to send (e.g. `content-type`, the `DPoP` proof, and the
   * `X-DPoP-Token` access token). The `host` header is derived from the URL and
   * must not be supplied here. Header names are case-insensitive.
   */
  headers?: Record<string, string>;
  /** Already-serialized request body. */
  body?: string;
}

export type LatticeFetchFn = (input: LatticeRequestInput) => Promise<Response>;

/**
 * Build a fetch-like function that SigV4-signs every request with the caller's
 * task-role credentials before sending it to a VPC Lattice service that uses
 * `auth_type = AWS_IAM`.
 *
 * This is the network-layer auth (Lattice IAM). It sits UNDERNEATH the app-layer
 * DPoP auth: callers should pass the DPoP proof (`DPoP`) and the DPoP-bound
 * access token (`X-DPoP-Token`, see {@link DPOP_TOKEN_HEADER}) in
 * `input.headers`; this client signs the whole thing and the SigV4 result lands
 * in `Authorization`.
 */
export function createLatticeFetch(opts: LatticeFetchOptions): LatticeFetchFn {
  const service = opts.service ?? LATTICE_SIGNING_SERVICE;
  const credentials = opts.credentials ?? fromNodeProviderChain();
  const fetchImpl = opts.fetchImpl ?? fetch;

  const signer = new SignatureV4({
    service,
    region: opts.region,
    credentials,
    sha256: Sha256,
  });

  return async function latticeFetch(input: LatticeRequestInput): Promise<Response> {
    const url = new URL(input.url);

    // SigV4 canonical query string is built from the parsed query params.
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      query[key] = value;
    }

    // The `host` header is part of the SigV4 signed headers and must match the
    // URL authority. Caller-supplied headers are layered on top (lower-cased to
    // avoid duplicate keys differing only by case).
    const headers: Record<string, string> = { host: url.host };
    if (input.headers) {
      for (const [key, value] of Object.entries(input.headers)) {
        headers[key] = value;
      }
    }

    const httpRequest = new HttpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      method: input.method.toUpperCase(),
      path: url.pathname,
      query,
      headers,
      ...(url.port ? { port: Number(url.port) } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    });

    const signed = await signer.sign(httpRequest);

    // Reassemble the (possibly query-bearing) URL for fetch. SigV4 here is a
    // header-based signature, so the query string is unchanged, but rebuild it
    // from the signed request to stay authoritative.
    const signedQuery = new URLSearchParams();
    for (const [key, value] of Object.entries(signed.query ?? {})) {
      if (Array.isArray(value)) {
        for (const v of value) signedQuery.append(key, v);
      } else if (value !== null && value !== undefined) {
        signedQuery.set(key, value);
      }
    }
    const search = signedQuery.toString();
    const finalUrl = `${signed.protocol}//${url.host}${signed.path}${search ? `?${search}` : ''}`;

    const init: RequestInit = {
      method: signed.method,
      headers: signed.headers,
    };
    if (input.body !== undefined) {
      init.body = input.body;
    }

    return fetchImpl(finalUrl, init);
  };
}
