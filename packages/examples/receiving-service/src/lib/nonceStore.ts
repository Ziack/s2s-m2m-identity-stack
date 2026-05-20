import { createRedisNonceStore, getRedisClient } from '@s2s/auth-library';
import type { NonceStore } from '@s2s/auth-library';

/**
 * Build a NonceStore backed by ioredis (Plan 01's `createRedisNonceStore`).
 * The receiver's `verifyDPoP({ requireNonce, nonceStore })` consumes this.
 */
export function createNonceStore(endpoint: string, prefix = 'dpop-nonce:'): NonceStore {
  const redis = getRedisClient(endpoint);
  return createRedisNonceStore({ redis, prefix, ttlSeconds: 300 });
}
