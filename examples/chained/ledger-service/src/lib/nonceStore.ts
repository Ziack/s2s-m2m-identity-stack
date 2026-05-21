import { createRedisNonceStore, getRedisClient } from '@s2s/auth-library';
import type { NonceStore } from '@s2s/auth-library';

/**
 * Build a NonceStore backed by ioredis for the ledger service.
 * Distinct key prefix from the receiver so the two services don't
 * share or burn each other's nonces.
 */
export function createNonceStore(endpoint: string, prefix = 'ledger-dpop-nonce:'): NonceStore {
  const redis = getRedisClient(endpoint);
  return createRedisNonceStore({ redis, prefix, ttlSeconds: 300 });
}
