import { AuthError, ERROR_CODES } from '../errors.js';

export type NonceAwareFn<T> = (nonce: string | undefined) => Promise<T>;

/**
 * Wrap an async function that issues a DPoP-protected outbound request.
 * Retries exactly once on `AuthError(USE_DPOP_NONCE)`, echoing the
 * server-supplied nonce from `WWW-Authenticate: DPoP nonce=...` (carried in
 * `err.challengeNonce`) into the next attempt.
 */
export async function withDPoPNonceRetry<T>(fn: NonceAwareFn<T>): Promise<T> {
  try {
    return await fn(undefined);
  } catch (err) {
    if (err instanceof AuthError && err.code === ERROR_CODES.USE_DPOP_NONCE) {
      const challenge =
        err.challengeNonce ??
        (err.details as { challengeNonce?: string } | undefined)?.challengeNonce;
      if (typeof challenge === 'string' && challenge.length > 0) {
        return await fn(challenge);
      }
    }
    throw err;
  }
}
