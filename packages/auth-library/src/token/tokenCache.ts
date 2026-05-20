import { createHash } from 'node:crypto';
import type { Redis as RedisType } from 'ioredis';
import type { TokenResult } from '../types.js';
import { metrics } from '../observability/metrics.js';

const BUFFER_SECONDS = 30;

export function cacheKey(clientId: string, scopes: string[]): string {
  const sorted = [...scopes].sort().join(',');
  const hash = createHash('sha256').update(sorted).digest('hex');
  return `m2m:${clientId}:${hash}`;
}

export interface TokenCacheOptions {
  redis: RedisType;
  nowFn?: () => number;
}

interface L1Entry {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}

interface PersistedEntry {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}

export class TokenCache {
  private l1 = new Map<string, L1Entry>();
  private hits = { l1: 0, l2: 0 };
  private misses = { l1: 0, l2: 0 };

  constructor(private opts: TokenCacheOptions) {}

  private now(): number {
    return this.opts.nowFn ? this.opts.nowFn() : Date.now();
  }

  clearL1(): void { this.l1.clear(); }

  async set(input: { clientId: string; scopes: string[]; accessToken: string; expiresAt: number }): Promise<void> {
    const key = cacheKey(input.clientId, input.scopes);
    // Write raw remaining-lifetime as the L2 TTL. The BUFFER_SECONDS margin is
    // applied at READ time in `get()` (freshness check) — not subtracted from
    // the write TTL — so `getStale()` can still retrieve the entry within the
    // buffer window after the token is considered fresh-expired.
    const ttlSeconds = Math.max(1, input.expiresAt - Math.floor(this.now() / 1000));
    const entry: L1Entry = { accessToken: input.accessToken, expiresAt: input.expiresAt, scopes: [...input.scopes] };
    this.l1.set(key, entry);
    const persisted: PersistedEntry = entry;
    await this.opts.redis.set(key, JSON.stringify(persisted), 'EX', ttlSeconds);
  }

  async get(input: { clientId: string; scopes: string[] }): Promise<TokenResult | null> {
    const key = cacheKey(input.clientId, input.scopes);
    const nowSec = Math.floor(this.now() / 1000);
    const l1 = this.l1.get(key);
    if (l1 && l1.expiresAt - BUFFER_SECONDS > nowSec) {
      this.hits.l1++;
      this.updateRatio();
      return { accessToken: l1.accessToken, expiresAt: l1.expiresAt, scopes: l1.scopes, tokenSource: 'cache-l1' };
    }
    if (l1) this.l1.delete(key);
    this.misses.l1++;

    const raw = await this.opts.redis.get(key);
    if (raw === null) {
      this.misses.l2++;
      this.updateRatio();
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedEntry;
    if (parsed.expiresAt - BUFFER_SECONDS <= nowSec) {
      this.misses.l2++;
      this.updateRatio();
      return null;
    }
    this.l1.set(key, parsed);
    this.hits.l2++;
    this.updateRatio();
    return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt, scopes: parsed.scopes, tokenSource: 'cache-l2' };
  }

  async getStale(input: { clientId: string; scopes: string[] }): Promise<TokenResult | null> {
    const key = cacheKey(input.clientId, input.scopes);
    const raw = await this.opts.redis.get(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as PersistedEntry;
    return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt, scopes: parsed.scopes, tokenSource: 'cache-l2' };
  }

  private updateRatio(): void {
    const l1Total = this.hits.l1 + this.misses.l1;
    const l2Total = this.hits.l2 + this.misses.l2;
    if (l1Total > 0) metrics.tokenCacheHitRatio.set({ cache_level: 'l1' }, this.hits.l1 / l1Total);
    if (l2Total > 0) metrics.tokenCacheHitRatio.set({ cache_level: 'l2' }, this.hits.l2 / l2Total);
  }
}
