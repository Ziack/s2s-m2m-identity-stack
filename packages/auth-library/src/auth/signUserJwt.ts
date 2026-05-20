import { SignJWT, type KeyLike } from 'jose';
import { randomUUID } from 'node:crypto';

export interface SignUserJwtOptions {
  /** RSA private key (loaded via jose's `importPKCS8` / Node `createPrivateKey`). */
  privateKey: KeyLike;
  /** Key ID matching the JWKS published by the local issuer. */
  kid: string;
  /** Issuer URL, e.g. `https://calling-service/auth`. */
  issuer: string;
  /** Audience — string or string array. */
  audience: string | string[];
  /** Token TTL in seconds. Default 900 (15min). */
  ttlSeconds?: number;
  /** Signing algorithm. Default `RS256`. */
  algorithm?: 'RS256' | 'PS256';
}

export interface SignUserJwtInput {
  sub: string;
  roles?: string[];
  groups?: string[];
  customClaims?: Record<string, unknown>;
  /** Injectable clock (ms) for tests. */
  nowFn?: () => number;
}

const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_ALG: 'RS256' | 'PS256' = 'RS256';

const RESERVED_CLAIMS = new Set(['iss', 'sub', 'aud', 'exp', 'iat', 'nbf', 'jti']);

export async function signUserJwt(opts: SignUserJwtOptions, input: SignUserJwtInput): Promise<string> {
  const now = input.nowFn ?? Date.now;
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const alg = opts.algorithm ?? DEFAULT_ALG;
  const nowSec = Math.floor(now() / 1000);
  const expSec = nowSec + ttl;
  const jti = randomUUID();

  const claims: Record<string, unknown> = {};
  if (input.customClaims) {
    for (const [k, v] of Object.entries(input.customClaims)) {
      if (RESERVED_CLAIMS.has(k)) continue;
      claims[k] = v;
    }
  }
  if (input.roles !== undefined) claims.roles = input.roles;
  if (input.groups !== undefined) claims.groups = input.groups;

  return new SignJWT(claims)
    .setProtectedHeader({ alg, kid: opts.kid, typ: 'JWT' })
    .setIssuer(opts.issuer)
    .setSubject(input.sub)
    .setAudience(opts.audience)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .setJti(jti)
    .sign(opts.privateKey);
}
