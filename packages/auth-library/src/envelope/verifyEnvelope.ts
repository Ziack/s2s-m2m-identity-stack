import { jwtVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose';
import { createHash } from 'node:crypto';
import type { Redis as RedisType } from 'ioredis';
import type { VerifiedEnvelope, StalenessQueueType } from '../types.js';

export const DEFAULT_STALENESS: Record<StalenessQueueType, number> = {
  sqs_standard: 15 * 60,
  sqs_fifo: 5 * 60,
  dlq: 24 * 60 * 60,
  eventbridge: 15 * 60,
};

export interface VerifyEnvelopeDeps {
  redis: RedisType;
  nowFn?: () => number;
  dedupTtlSeconds?: number;
}

export interface VerifyEnvelopeOptions {
  expectedQueueArn: string;
  queueType?: StalenessQueueType;
  stalenessThresholdSeconds?: number;
  skipDedup?: boolean;
}

export function createVerifyEnvelope(deps: VerifyEnvelopeDeps) {
  const now = deps.nowFn ?? Date.now;
  const dedupTtl = deps.dedupTtlSeconds ?? 24 * 60 * 60;

  return async function verifyEnvelope(message: { envelope: string; payload: object | Buffer }, options: VerifyEnvelopeOptions): Promise<VerifiedEnvelope> {
    const start = process.hrtime.bigint();
    const header = decodeProtectedHeader(message.envelope);
    if (!header.jwk) throw new Error('envelope header missing jwk');
    const key = await importJWK(header.jwk as JWK, 'ES256');
    const { payload } = await jwtVerify(message.envelope, key, { algorithms: ['ES256'] });
    const claims = payload as Record<string, unknown>;

    if (claims.queue_arn !== options.expectedQueueArn) {
      throw new Error(`queue_arn mismatch: expected ${options.expectedQueueArn} got ${String(claims.queue_arn)}`);
    }
    const computedHash = Buffer.isBuffer(message.payload)
      ? createHash('sha256').update(message.payload).digest('base64url')
      : createHash('sha256').update(JSON.stringify(message.payload)).digest('base64url');
    if (computedHash !== claims.body_hash) {
      throw new Error('body_hash mismatch — payload tampered or out of order');
    }
    const iat = Number(claims.iat ?? 0);
    const threshold = options.stalenessThresholdSeconds ?? DEFAULT_STALENESS[options.queueType ?? 'sqs_standard'];
    const nowSec = Math.floor(now() / 1000);
    if (nowSec - iat > threshold) {
      throw new Error(`envelope is stale (iat ${iat}, threshold ${threshold}s)`);
    }
    if (!options.skipDedup) {
      const jti = String(claims.jti);
      const r = await deps.redis.set(`env:jti:${jti}`, '1', 'EX', dedupTtl, 'NX');
      if (r !== 'OK') throw new Error('envelope dedup detected jti replay');
    }
    return {
      principal: String(claims.iss),
      action: String(claims.action),
      claims,
      verifiedAt: new Date(now()).toISOString(),
      verificationDurationMs: Number(process.hrtime.bigint() - start) / 1e6,
    };
  };
}
