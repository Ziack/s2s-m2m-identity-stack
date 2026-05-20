import { jwtVerify, decodeProtectedHeader, importJWK, calculateJwkThumbprint, type JWK } from 'jose';
import { createHash } from 'node:crypto';
import type { Redis as RedisType } from 'ioredis';
import { AuthError, ERROR_CODES } from '../errors.js';
import type { DPoPVerificationResult, NonceStore } from '../types.js';
import { metrics } from '../observability/metrics.js';
import { withSpan, SPAN_NAMES } from '../observability/tracing.js';
import { generateDPoPNonce } from './dpopNonce.js';

export interface VerifyDPoPDeps {
  redis: RedisType;
  nowFn?: () => number;
  nonceTtlSeconds?: number;
  iatToleranceSeconds?: number;
  nonceStore?: NonceStore;
  requireNonce?: boolean;
}

export interface VerifyDPoPInput {
  dpopProof: string;
  accessToken: string;
  expectedHtm: string;
  expectedHtu: string;
}

export type VerifyDPoPFn = (input: VerifyDPoPInput) => Promise<DPoPVerificationResult>;

export function createVerifyDPoP(deps: VerifyDPoPDeps): VerifyDPoPFn {
  const now = deps.nowFn ?? (() => Date.now());
  const nonceTtl = deps.nonceTtlSeconds ?? 120;
  const tolerance = deps.iatToleranceSeconds ?? 60;
  const requireNonce = deps.requireNonce === true;

  async function issueChallenge(): Promise<never> {
    const fresh = generateDPoPNonce();
    if (deps.nonceStore) {
      try { await deps.nonceStore.issue(fresh); } catch { /* collision — fall through */ }
    }
    throw new AuthError(401, ERROR_CODES.USE_DPOP_NONCE, 'server requires DPoP-Nonce echo', { challengeNonce: fresh });
  }

  return async function verify(input: VerifyDPoPInput): Promise<DPoPVerificationResult> {
    const start = process.hrtime.bigint();
    return withSpan(SPAN_NAMES.DPOP_VERIFY, async () => {
      let header: ReturnType<typeof decodeProtectedHeader>;
      try {
        header = decodeProtectedHeader(input.dpopProof);
      } catch {
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.INVALID_DPOP_PROOF });
        throw new AuthError(401, ERROR_CODES.INVALID_DPOP_PROOF, 'malformed dpop proof header');
      }
      if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256' || !header.jwk) {
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.INVALID_DPOP_PROOF });
        throw new AuthError(401, ERROR_CODES.INVALID_DPOP_PROOF, 'dpop header must be typ=dpop+jwt alg=ES256 with jwk');
      }
      const jwk = header.jwk as JWK;
      let key;
      try {
        key = await importJWK(jwk, 'ES256');
      } catch {
        throw new AuthError(401, ERROR_CODES.INVALID_DPOP_PROOF, 'invalid jwk');
      }
      let payload;
      try {
        const v = await jwtVerify(input.dpopProof, key, { algorithms: ['ES256'] });
        payload = v.payload as { htm?: string; htu?: string; iat?: number; jti?: string; ath?: string; nonce?: string };
      } catch {
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.INVALID_DPOP_PROOF });
        throw new AuthError(401, ERROR_CODES.INVALID_DPOP_PROOF, 'signature verification failed');
      }
      if (payload.htm !== input.expectedHtm || payload.htu !== input.expectedHtu) {
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.DPOP_BINDING_MISMATCH });
        throw new AuthError(401, ERROR_CODES.DPOP_BINDING_MISMATCH, 'htm/htu mismatch');
      }
      const iat = payload.iat ?? 0;
      const nowSec = Math.floor(now() / 1000);
      if (Math.abs(nowSec - iat) > tolerance) {
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.DPOP_PROOF_EXPIRED });
        throw new AuthError(401, ERROR_CODES.DPOP_PROOF_EXPIRED, `iat outside ±${tolerance}s`);
      }
      const expectedAth = createHash('sha256').update(input.accessToken).digest('base64url');
      if (payload.ath !== expectedAth) {
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.DPOP_TOKEN_MISMATCH });
        throw new AuthError(401, ERROR_CODES.DPOP_TOKEN_MISMATCH, 'ath claim does not match access token hash');
      }
      if (requireNonce) {
        if (!deps.nonceStore) throw new Error('verifyDPoP: requireNonce=true requires nonceStore dep');
        if (!payload.nonce) {
          metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.USE_DPOP_NONCE });
          await issueChallenge();
        }
        const consumed = await deps.nonceStore.consume(payload.nonce as string);
        if (!consumed) {
          metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
          metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.USE_DPOP_NONCE });
          await issueChallenge();
        }
      }
      const jti = payload.jti;
      if (!jti) {
        throw new AuthError(401, ERROR_CODES.INVALID_DPOP_PROOF, 'missing jti');
      }
      const setRes = await deps.redis.set(`dpop:jti:${jti}`, '1', 'EX', nonceTtl, 'NX');
      if (setRes !== 'OK') {
        metrics.nonceReplayTotal.inc({ client_id: 'unknown' });
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.DPOP_NONCE_REUSE });
        throw new AuthError(401, ERROR_CODES.DPOP_NONCE_REUSE, 'dpop jti replay');
      }
      const thumbprint = await calculateJwkThumbprint(jwk, 'sha256');
      metrics.dpopVerifyDuration.observe({ result: 'ok' }, Number(process.hrtime.bigint() - start) / 1e9);
      return { ok: true, jti, jwkThumbprint: thumbprint, iat };
    });
  };
}
