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
  // Control plane: the broker token-exchange ALWAYS uses the broker's ALB
  // endpoint with `client_secret_basic` (Authorization: Basic ...), in BOTH
  // Lattice and non-Lattice modes. SigV4 (used for the Lattice data plane) also
  // owns the Authorization header, so routing the exchange over Lattice would
  // clobber the Basic credential and the frozen broker would reject it. Only the
  // data-plane hops (calling → receiving, receiving → ledger) ride Lattice+SigV4.
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
