export interface RedisLike {
  set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
}

export interface ReplayStore {
  /** Returns true if jti is fresh (claimed), false on replay. Fails CLOSED on Redis errors. */
  claim(jti: string): Promise<boolean>;
}

export interface ReplayStoreOptions {
  redis: RedisLike;
  ttlSeconds: number;
  keyPrefix?: string;
}

export function createReplayStore(opts: ReplayStoreOptions): ReplayStore {
  const prefix = opts.keyPrefix ?? 'broker:jti:';
  return {
    async claim(jti) {
      const key = prefix + jti;
      try {
        const reply = await opts.redis.set(key, '1', 'EX', opts.ttlSeconds, 'NX');
        // ioredis returns 'OK' on success and null on NX conflict.
        return reply === 'OK';
      } catch {
        // Fail closed — treat as replay/unavailable.
        return false;
      }
    },
  };
}
