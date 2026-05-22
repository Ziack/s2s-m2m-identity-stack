import type { Request } from 'express';
import { createVerifyDPoP, type DPoPVerificationResult } from '@s2s/auth-library';
import type { Redis as RedisType } from 'ioredis';

/**
 * Verifies the DPoP proof presented on an RFC 8693 token-exchange request.
 *
 * The exchange request carries no access token, so its proof legitimately has
 * no `ath` (RFC 9449 §4.2). We delegate the full proof check (typ/alg/jwk,
 * signature, htm, htu, ±iat, jti replay) to the SDK's verifyDPoP with
 * `expectAth: false`, and use a SEPARATE jti keyspace (`dpop-exchange:`) so
 * exchange-proof jtis can never collide with resource-request DPoP jtis. The
 * returned `jwkThumbprint` is what the broker mints as the token's `cnf.jkt`.
 */
export interface ExchangeProofVerifier {
  /**
   * @param dpopProof the raw `DPoP:` request header value
   * @param expectedHtu the broker's own canonicalized token-endpoint URL
   * @returns the verification result; `jwkThumbprint` = the proof key thumbprint
   * @throws AuthError on any verification failure
   */
  verify(dpopProof: string, expectedHtu: string): Promise<DPoPVerificationResult>;
}

export interface ExchangeProofVerifierOptions {
  redis: RedisType;
  /** ±tolerance for the proof `iat`, seconds. Defaults to 60. */
  iatToleranceSeconds?: number;
  /** Replay-record TTL for proof jtis, seconds. Defaults to 120. */
  jtiTtlSeconds?: number;
  nowFn?: () => number;
}

export function createExchangeProofVerifier(
  opts: ExchangeProofVerifierOptions,
): ExchangeProofVerifier {
  const verifyDPoP = createVerifyDPoP({
    redis: opts.redis,
    jtiKeyPrefix: 'dpop-exchange:',
    nonceTtlSeconds: opts.jtiTtlSeconds ?? 120,
    ...(opts.iatToleranceSeconds !== undefined ? { iatToleranceSeconds: opts.iatToleranceSeconds } : {}),
    ...(opts.nowFn ? { nowFn: opts.nowFn } : {}),
  });

  return {
    verify(dpopProof, expectedHtu) {
      return verifyDPoP({
        dpopProof,
        expectedHtm: 'POST',
        expectedHtu,
        expectAth: false,
      });
    },
  };
}

/**
 * Canonicalizes a token-endpoint URL for `htu` comparison: scheme + host +
 * path, dropping any query/fragment and a single trailing slash. Matches the
 * SDK, which signs `htu = brokerTokenEndpoint` exactly (e.g.
 * `https://broker/oauth2/token`).
 */
export function canonicalizeHtu(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/$/, '');
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '');
  }
}

/**
 * Reconstructs the broker's own token-endpoint URL from the incoming request,
 * honouring X-Forwarded-Proto/-Host (requires `app.set('trust proxy', true)`).
 * The path is fixed to the broker's token endpoint so it equals what the SDK
 * signed as `htu`, regardless of the route the request arrived on.
 */
export function brokerTokenEndpointHtu(req: Request): string {
  const proto = req.protocol;
  const host = req.get('host') ?? '';
  return canonicalizeHtu(`${proto}://${host}/oauth2/token`);
}
