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
  /**
   * Redis key prefix for the proof's jti replay record. Defaults to
   * `dpop:jti:`. A distinct prefix (e.g. `dpop-exchange:`) lets a caller that
   * verifies exchange-request proofs keep their jti keyspace separate from
   * resource-request DPoP jtis so the two cannot collide.
   */
  jtiKeyPrefix?: string;
}

export interface VerifyDPoPInput {
  dpopProof: string;
  /**
   * Access token whose hash the proof's `ath` claim must equal. Required when
   * `expectAth` is true (the default). Omit (or pass undefined) together with
   * `expectAth: false` for an exchange-request proof, which presents no access
   * token and legitimately carries no `ath`.
   */
  accessToken?: string;
  expectedHtm: string;
  expectedHtu: string;
  /**
   * Whether to require and verify the `ath` claim. Defaults to true. Set to
   * false for a DPoP proof presented on the token-exchange request (RFC 9449
   * §4.2 makes `ath` required only "when a DPoP proof is used in conjunction
   * with an access token"); such proofs convey the caller's key and prove
   * possession without binding to any access token.
   */
  expectAth?: boolean;
  /**
   * The `cnf.jkt` from the validated access token (RFC 9449 §6 sender
   * constraint). When provided, the proof's key thumbprint must equal it or
   * verification throws `dpop_key_mismatch`. Pass `validatedToken.cnf?.jkt`.
   */
  expectedJkt?: string;
  /**
   * Hard-enforce that the token carries a `cnf.jkt`. When true and
   * `expectedJkt` is absent/empty, verification throws `dpop_key_mismatch`.
   * Defaults to false (Phase 1 back-compat; Phase 3 flips example middlewares
   * to pass true).
   */
  requireCnfBinding?: boolean;
}

export type VerifyDPoPFn = (input: VerifyDPoPInput) => Promise<DPoPVerificationResult>;

export function createVerifyDPoP(deps: VerifyDPoPDeps): VerifyDPoPFn {
  const now = deps.nowFn ?? (() => Date.now());
  const nonceTtl = deps.nonceTtlSeconds ?? 120;
  const tolerance = deps.iatToleranceSeconds ?? 60;
  const requireNonce = deps.requireNonce === true;
  const jtiPrefix = deps.jtiKeyPrefix ?? 'dpop:jti:';

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
      const expectAth = input.expectAth !== false;
      if (expectAth) {
        if (input.accessToken === undefined) {
          throw new Error('verifyDPoP: accessToken is required when expectAth is not false');
        }
        const expectedAth = createHash('sha256').update(input.accessToken).digest('base64url');
        if (payload.ath !== expectedAth) {
          metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
          metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.DPOP_TOKEN_MISMATCH });
          throw new AuthError(401, ERROR_CODES.DPOP_TOKEN_MISMATCH, 'ath claim does not match access token hash');
        }
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
      const setRes = await deps.redis.set(`${jtiPrefix}${jti}`, '1', 'EX', nonceTtl, 'NX');
      if (setRes !== 'OK') {
        metrics.nonceReplayTotal.inc({ client_id: 'unknown' });
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.DPOP_NONCE_REUSE });
        throw new AuthError(401, ERROR_CODES.DPOP_NONCE_REUSE, 'dpop jti replay');
      }
      const thumbprint = await calculateJwkThumbprint(jwk, 'sha256');
      // RFC 9449 §6 sender-constraint: the proof key must match the token's cnf.jkt.
      if (input.requireCnfBinding === true && (input.expectedJkt === undefined || input.expectedJkt === '')) {
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.DPOP_KEY_MISMATCH });
        throw new AuthError(401, ERROR_CODES.DPOP_KEY_MISMATCH, 'access token is not sender-constrained (missing cnf.jkt)');
      }
      if (input.expectedJkt !== undefined && input.expectedJkt !== '' && input.expectedJkt !== thumbprint) {
        metrics.dpopVerifyDuration.observe({ result: 'fail' }, Number(process.hrtime.bigint() - start) / 1e9);
        metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: ERROR_CODES.DPOP_KEY_MISMATCH });
        throw new AuthError(401, ERROR_CODES.DPOP_KEY_MISMATCH, 'dpop key thumbprint does not match token cnf.jkt');
      }
      metrics.dpopVerifyDuration.observe({ result: 'ok' }, Number(process.hrtime.bigint() - start) / 1e9);
      return { ok: true, jti, jwkThumbprint: thumbprint, iat };
    });
  };
}
