/**
 * Lazy-initialised wrapper around the SDK's `createExchangeToken`.
 *
 * Built once at process start (or lazily on first sync request) using the
 * broker URL, the actor identity (this service's client_id at the broker),
 * and the actor client_secret loaded from Secrets Manager. Tests bypass the
 * real factory via `setExchangeTokenForTest`.
 */
import { createExchangeToken, getClientSecret, type ExchangeTokenFn } from '@s2s/auth-library';
import { latticeFetchAdapter, useLattice } from './latticeFetch.js';
import type { CallingServiceConfig } from '../config.js';

let exchangeFn: ExchangeTokenFn | null = null;

export function setExchangeTokenForTest(fn: ExchangeTokenFn | null): void {
  exchangeFn = fn;
}

export function initExchangeClient(config: CallingServiceConfig): void {
  if (exchangeFn) return;
  // Lattice mode: hit the broker's Lattice DNS and SigV4-sign the exchange via
  // the lattice fetch adapter. Otherwise use the broker token endpoint over the
  // default fetch (ALB path).
  const lattice = useLattice() && !!config.brokerLatticeDns;
  const brokerUrl = lattice
    ? `https://${config.brokerLatticeDns}${new URL(config.brokerTokenEndpoint).pathname}`
    : config.brokerTokenEndpoint;
  exchangeFn = createExchangeToken({
    brokerUrl,
    ...(lattice ? { fetchImpl: latticeFetchAdapter(config.awsRegion) } : {}),
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
