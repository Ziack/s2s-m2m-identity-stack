import type { TokenCache } from './tokenCache.js';
import type { TokenResult } from '../types.js';
import { acquireTokenWithRetry } from './acquireTokenRetry.js';
import { metrics } from '../observability/metrics.js';
import { withSpan, SPAN_NAMES } from '../observability/tracing.js';
import { getLogger } from '../observability/logger.js';
import { buildBreaker, type NamedBreaker } from '../resilience/circuitBreaker.js';

export interface AcquireTokenDeps {
  cognitoDomain: string;
  clientSecret: string;
  cache: TokenCache;
  fetchImpl?: typeof fetch;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  breaker?: NamedBreaker;
  retryConfig?: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
}

export interface AcquireOptions {
  forceRefresh?: boolean;
  cacheLevel?: 'L1' | 'L2' | 'both';
  timeout?: number;
  retryConfig?: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
}

const DEFAULTS = { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 5000 };

export type AcquireTokenFn = (clientId: string, scopes: string[], options?: AcquireOptions) => Promise<TokenResult>;

export function createAcquireToken(deps: AcquireTokenDeps): AcquireTokenFn {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.nowFn ?? (() => Date.now());
  const breaker = deps.breaker ?? buildBreaker('cognito', { failureThreshold: 5, halfOpenAfterMs: 30_000, samplingDurationMs: 60_000 });
  const log = getLogger();

  async function acquire(clientId: string, scopes: string[], options?: AcquireOptions): Promise<TokenResult> {
    return withSpan(SPAN_NAMES.TOKEN_ACQUIRE, async (span) => {
      const start = process.hrtime.bigint();
      span.setAttribute('m2m.client_id', clientId);
      if (!options?.forceRefresh) {
        const cached = await deps.cache.get({ clientId, scopes });
        if (cached !== null) {
          metrics.tokenAcquireDuration.observe({ client_id: clientId, cache_hit: 'true' }, Number(process.hrtime.bigint() - start) / 1e9);
          return cached;
        }
      }
      const retryCfg = options?.retryConfig ?? deps.retryConfig ?? DEFAULTS;
      try {
        const tokenResp = await breaker.execute(() =>
          acquireTokenWithRetry(
            { cognitoDomain: deps.cognitoDomain, clientId, clientSecret: deps.clientSecret, scopes, fetchImpl },
            { ...retryCfg, ...(deps.sleepFn ? { sleepFn: deps.sleepFn } : {}) },
          ),
        );
        const expiresAt = Math.floor(now() / 1000) + tokenResp.expires_in;
        const result: TokenResult = {
          accessToken: tokenResp.access_token,
          expiresAt,
          scopes: tokenResp.scope ? tokenResp.scope.split(' ') : scopes,
          tokenSource: 'cognito',
        };
        await deps.cache.set({ clientId, scopes: result.scopes, accessToken: result.accessToken, expiresAt });
        metrics.tokenAcquireDuration.observe({ client_id: clientId, cache_hit: 'false' }, Number(process.hrtime.bigint() - start) / 1e9);
        return result;
      } catch (err) {
        const stale = await deps.cache.getStale({ clientId, scopes });
        if (stale !== null) {
          log.warn({ caller_client_id: clientId, mode: 'degraded-mode', err_msg: (err as Error).message }, 'serving stale token due to Cognito failure');
          metrics.tokenAcquireDuration.observe({ client_id: clientId, cache_hit: 'true' }, Number(process.hrtime.bigint() - start) / 1e9);
          return stale;
        }
        metrics.authFailureTotal.inc({ step: 'acquireToken', error_code: 'cognito_unreachable' });
        throw err;
      }
    });
  }

  return acquire;
}
