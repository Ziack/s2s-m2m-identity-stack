import { acquireTokenRaw, CognitoTokenError, type AcquireTokenRawInput, type CognitoTokenResponse } from './acquireTokenRaw.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export async function acquireTokenWithRetry(
  input: AcquireTokenRawInput,
  cfg: RetryConfig,
): Promise<CognitoTokenResponse> {
  const sleep = cfg.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await acquireTokenRaw(input);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof CognitoTokenError)) throw err;
      const retryable = err.status === 429 || (err.status >= 500 && err.status < 600);
      if (!retryable) throw err;
      if (attempt === cfg.maxRetries) throw err;
      const base = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * base);
      await sleep(base + jitter);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('acquireTokenWithRetry exhausted');
}
