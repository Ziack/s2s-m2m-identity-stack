import type { Redis as RedisType } from 'ioredis';

interface Entry { value: string; expiresAtMs: number | null }

export class RedisMock {
  private store = new Map<string, Entry>();
  private now: () => number = () => Date.now();

  setNowFn(fn: () => number) { this.now = fn; }

  private alive(k: string): Entry | null {
    const e = this.store.get(k);
    if (!e) return null;
    if (e.expiresAtMs !== null && e.expiresAtMs <= this.now()) {
      this.store.delete(k);
      return null;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    let ttlMs: number | null = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase();
      if (a === 'EX') { ttlMs = Number(args[i + 1]) * 1000; i++; }
      else if (a === 'PX') { ttlMs = Number(args[i + 1]); i++; }
      else if (a === 'NX') { nx = true; }
    }
    if (nx && this.alive(key) !== null) return null;
    this.store.set(key, { value, expiresAtMs: ttlMs === null ? null : this.now() + ttlMs });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const e = this.alive(key);
    if (!e) return -2;
    if (e.expiresAtMs === null) return -1;
    return Math.ceil((e.expiresAtMs - this.now()) / 1000);
  }

  async ping(): Promise<'PONG'> { return 'PONG'; }
  async quit(): Promise<'OK'> { return 'OK'; }
  async disconnect(): Promise<void> { /* no-op */ }
  on() { return this; }
}

export function asRedis(mock: RedisMock): RedisType {
  return mock as unknown as RedisType;
}
