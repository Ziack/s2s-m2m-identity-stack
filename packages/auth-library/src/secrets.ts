import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const DEFAULT_TTL_MS = 3_600_000; // 1 hour

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const _cache = new Map<string, CacheEntry>();
let _clientOverride: SecretsManagerClient | null = null;
let _nowFn: () => number = Date.now;

export function setSecretsClientForTest(c: SecretsManagerClient | null): void {
  _clientOverride = c;
}

export function setNowFnForTest(fn: (() => number) | null): void {
  _nowFn = fn ?? Date.now;
}

export interface GetClientSecretOptions {
  ttlMs?: number;
  client?: SecretsManagerClient;
  region?: string;
}

// Backward-compatible: accepts either (arn, region) string form or (arn, opts) form.
export async function getClientSecret(
  arn: string,
  regionOrOpts?: string | GetClientSecretOptions,
): Promise<string> {
  const opts: GetClientSecretOptions =
    typeof regionOrOpts === 'string' ? { region: regionOrOpts } : (regionOrOpts ?? {});
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = _nowFn();

  const cached = _cache.get(arn);
  if (cached !== undefined && now - cached.fetchedAt < ttlMs) {
    return cached.value;
  }

    const client =
    opts.client ??
    _clientOverride ??
    (opts.region !== undefined
      ? new SecretsManagerClient({ region: opts.region })
      : new SecretsManagerClient({}));
  const resp = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!resp.SecretString) throw new Error(`Secret ${arn} has no SecretString`);
  _cache.set(arn, { value: resp.SecretString, fetchedAt: now });
  return resp.SecretString;
}

export function invalidateClientSecret(arn: string): void {
  _cache.delete(arn);
}

export function resetSecretsCacheForTest(): void {
  _cache.clear();
}
