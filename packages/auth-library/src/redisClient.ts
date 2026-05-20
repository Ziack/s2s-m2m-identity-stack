import { Redis, type RedisOptions, type Redis as RedisType } from 'ioredis';

let _client: RedisType | null = null;

export interface RedisFactoryOptions {
  endpoint: string;
  password?: string;
  tls?: boolean;
}

export function buildRedis(opts: RedisFactoryOptions): RedisType {
  const url = new URL(opts.endpoint);
  const options: RedisOptions = {
    host: url.hostname,
    port: Number(url.port || 6379),
    tls: opts.tls === false ? undefined : {},
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  };
  if (opts.password) options.password = opts.password;
  return new Redis(options);
}

export function setRedisClientForTest(client: RedisType): void {
  _client = client;
}

export function getRedisClient(endpoint: string): RedisType {
  if (_client !== null) return _client;
  _client = buildRedis({ endpoint, tls: endpoint.startsWith('rediss://') });
  return _client;
}

export function resetRedisClientForTest(): void {
  _client = null;
}

/**
 * Health probe — returns true if the active Redis client responds to PING.
 * Throws if no client has been initialised or if the PING fails.
 * Consumed by example services for `/health/auth`.
 */
export async function pingRedis(): Promise<true> {
  if (_client === null) throw new Error('redis client not initialised');
  const reply = await (_client as unknown as { ping: () => Promise<string> }).ping();
  if (reply !== 'PONG') throw new Error(`unexpected PING reply: ${reply}`);
  return true;
}
