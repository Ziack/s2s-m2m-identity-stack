import { generateKeyPair, exportPKCS8, exportJWK, calculateJwkThumbprint, SignJWT, type KeyLike, type JWK } from 'jose';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface TestKeyMaterial {
  privateKey: KeyLike;
  publicKey: KeyLike;
  privatePem: string;
  publicJwk: JWK & { kid: string };
  kid: string;
}

export async function makeRsaKey(): Promise<TestKeyMaterial> {
  const kp = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  const privatePem = await exportPKCS8(kp.privateKey);
  const jwk = await exportJWK(kp.publicKey);
  const publicJwk: JWK = { kty: jwk.kty, n: jwk.n, e: jwk.e };
  const kid = await calculateJwkThumbprint(publicJwk, 'sha256');
  return {
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
    privatePem,
    publicJwk: { ...publicJwk, kid, use: 'sig', alg: 'RS256' } as JWK & { kid: string },
    kid,
  };
}

export async function signTestUserJwt(opts: {
  privateKey: KeyLike;
  kid: string;
  issuer: string;
  audience: string;
  sub: string;
  ttlSeconds?: number;
  roles?: string[];
  groups?: string[];
  extraClaims?: Record<string, unknown>;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { ...(opts.extraClaims ?? {}) };
  if (opts.roles) claims.roles = opts.roles;
  if (opts.groups) claims.groups = opts.groups;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid, typ: 'JWT' })
    .setIssuer(opts.issuer)
    .setSubject(opts.sub)
    .setAudience(opts.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.ttlSeconds ?? 600))
    .setJti(randomUUID())
    .sign(opts.privateKey);
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function writeTempActorCatalog(entries: Record<string, {
  client_secret_hash: string;
  allowed_audiences: string[];
  allowed_scopes: string[];
}>): string {
  const dir = mkdtempSync(join(tmpdir(), 'broker-catalog-'));
  const path = join(dir, 'actors.json');
  writeFileSync(path, JSON.stringify(entries, null, 2), 'utf8');
  return path;
}

export interface InMemoryRedis {
  set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
  has(key: string): boolean;
  reset(): void;
}

export function makeInMemoryRedis(): InMemoryRedis {
  const store = new Map<string, string>();
  return {
    async set(key, value, ...args) {
      const isNx = args.includes('NX');
      if (isNx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    has(k) { return store.has(k); },
    reset() { store.clear(); },
  };
}

export function buildJwksFetcher(keys: JWK[]): typeof fetch {
  const body = JSON.stringify({ keys });
  return (async (_input: unknown, _init?: unknown) => {
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(body) as { keys: JWK[] },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}
