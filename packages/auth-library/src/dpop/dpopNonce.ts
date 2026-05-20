import { randomBytes } from 'node:crypto';
import type { Redis as RedisType } from 'ioredis';
import type { DPoPNonce, NonceStore } from '../types.js';

export function generateDPoPNonce(): DPoPNonce {
  return randomBytes(32).toString('base64url');
}

export interface RedisNonceStoreOptions {
  redis: RedisType;
  ttlSeconds?: number;
  prefix?: string;
}

export function createRedisNonceStore(opts: RedisNonceStoreOptions): NonceStore {
  const ttl = opts.ttlSeconds ?? 300;
  const prefix = opts.prefix ?? 'dpop:nonce:';
  return {
    async issue(nonce: DPoPNonce): Promise<void> {
      const res = await opts.redis.set(`${prefix}${nonce}`, '1', 'EX', ttl, 'NX');
      if (res !== 'OK') throw new Error('nonce collision (already issued)');
    },
    async consume(nonce: DPoPNonce): Promise<boolean> {
      const removed = await opts.redis.del(`${prefix}${nonce}`);
      return removed === 1;
    },
  };
}
