import { SignJWT } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import { getActivePrivateKey, getPublicJwk } from './keyManager.js';
import { metrics } from '../observability/metrics.js';
import type { DPoPProof } from '../types.js';

export interface SignDPoPOptions {
  /**
   * Access token to bind via the `ath` claim. Optional: for a DPoP proof
   * presented on the token-exchange request there is no access token yet — the
   * proof's purpose there is to convey the caller's public key and prove
   * possession, so `ath` is legitimately omitted (RFC 9449 §4.2 makes `ath`
   * required only "when a DPoP proof is used in conjunction with an access
   * token"). When undefined, no `ath` claim is emitted.
   */
  accessToken?: string;
  htm: string;
  htu: string;
  nonce?: string;
}

export async function signDPoP(options: SignDPoPOptions): Promise<DPoPProof> {
  const start = process.hrtime.bigint();
  const jti = randomUUID();
  const payload: Record<string, unknown> = {
    htm: options.htm,
    htu: options.htu,
    jti,
  };
  if (options.accessToken !== undefined) {
    payload.ath = createHash('sha256').update(options.accessToken).digest('base64url');
  }
  if (options.nonce !== undefined) payload.nonce = options.nonce;
  const proof = await new SignJWT(payload)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: getPublicJwk() })
    .setIssuedAt()
    .sign(getActivePrivateKey());
  const elapsedSec = Number(process.hrtime.bigint() - start) / 1e9;
  metrics.dpopSignDuration.observe({ algorithm: 'ES256' }, elapsedSec);
  return { proof, jti };
}
