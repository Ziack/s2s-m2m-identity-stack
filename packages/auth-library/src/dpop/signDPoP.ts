import { SignJWT } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import { getActivePrivateKey, getPublicJwk } from './keyManager.js';
import { metrics } from '../observability/metrics.js';
import type { DPoPProof } from '../types.js';

export interface SignDPoPOptions {
  accessToken: string;
  htm: string;
  htu: string;
  nonce?: string;
}

export async function signDPoP(options: SignDPoPOptions): Promise<DPoPProof> {
  const start = process.hrtime.bigint();
  const jti = randomUUID();
  const ath = createHash('sha256').update(options.accessToken).digest('base64url');
  const payload: Record<string, unknown> = {
    htm: options.htm,
    htu: options.htu,
    jti,
    ath,
  };
  if (options.nonce !== undefined) payload.nonce = options.nonce;
  const proof = await new SignJWT(payload)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: getPublicJwk() })
    .setIssuedAt()
    .sign(getActivePrivateKey());
  const elapsedSec = Number(process.hrtime.bigint() - start) / 1e9;
  metrics.dpopSignDuration.observe({ algorithm: 'ES256' }, elapsedSec);
  return { proof, jti };
}
