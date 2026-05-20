/**
 * Lazy-initialised wrapper around the SDK's `createExchangeToken`.
 *
 * Built once at process start (or lazily on first sync request) using the
 * broker URL, the actor identity (this service's client_id at the broker),
 * and the actor client_secret loaded from Secrets Manager. Tests bypass the
 * real factory via `setExchangeTokenForTest`.
 */
import { createExchangeToken, getClientSecret, type ExchangeTokenFn } from '@s2s/auth-library';
import type { CallingServiceConfig } from '../config.js';

let exchangeFn: ExchangeTokenFn | null = null;

export function setExchangeTokenForTest(fn: ExchangeTokenFn | null): void {
  exchangeFn = fn;
}

export function initExchangeClient(config: CallingServiceConfig): void {
  if (exchangeFn) return;
  exchangeFn = createExchangeToken({
    brokerUrl: config.brokerTokenEndpoint,
    actorClientId: config.brokerActorClientId,
    actorClientSecret: async () => {
      const raw = await getClientSecret(config.brokerActorSecretArn, config.awsRegion);
      try {
        const parsed = JSON.parse(raw) as { client_secret?: string };
        return parsed.client_secret ?? raw;
      } catch {
        return raw;
      }
    },
    audience: config.targetAudience,
    scope: config.scopes,
  });
}

export function getExchangeToken(): ExchangeTokenFn {
  if (!exchangeFn) {
    throw new Error('exchangeClient not initialized — call initExchangeClient first');
  }
  return exchangeFn;
}
