import { jwtVerify, importJWK, type JWK } from 'jose';
import { AuthError, ERROR_CODES } from '../errors.js';
import type { JwksManager } from '../validation/jwksManager.js';
import type { UserContext } from '../types.js';
import { metrics } from '../observability/metrics.js';
import { withSpan, SPAN_NAMES } from '../observability/tracing.js';

export interface ValidateUserTokenOptions {
  /** A JwksManager instance pointed at USER_ISSUER_URL. Kept separate from the M2M JwksManager so user-issuer keys are isolated. */
  jwksManager: JwksManager;
  /** Expected `iss` claim, e.g. `https://calling-service/auth` or a Keycloak realm URL. */
  expectedIssuer: string;
  /** Expected `aud` claim — typically the entrypoint service identifier. */
  expectedAudience: string;
  /** Injectable clock for tests. */
  nowFn?: () => number;
}

export interface ValidateUserTokenInput {
  /** Raw JWT compact form. */
  token: string;
}

export type ValidateUserTokenFn = (input: ValidateUserTokenInput) => Promise<UserContext>;

const RESERVED_CLAIMS = new Set(['iss', 'sub', 'aud', 'exp', 'iat', 'nbf', 'jti', 'roles', 'groups']);

function readKid(token: string): string | null {
  const seg = token.split('.')[0];
  if (!seg) return null;
  try {
    const decoded = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as { kid?: string };
    return decoded.kid ?? null;
  } catch {
    return null;
  }
}

function normaliseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return [];
    return trimmed.split(/\s+/);
  }
  return [];
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  if (Array.isArray(aud)) return aud.some((a) => a === expected);
  return false;
}

function extractCustomClaims(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!RESERVED_CLAIMS.has(k)) out[k] = v;
  }
  return out;
}

export function createValidateUserToken(opts: ValidateUserTokenOptions): ValidateUserTokenFn {
  const now = opts.nowFn ?? Date.now;

  async function findKey(kid: string | null): Promise<JWK> {
    const keys = await opts.jwksManager.getKeys();
    const match = kid ? keys.find((k) => (k as { kid?: string }).kid === kid) : keys[0];
    if (match) return match;
    const refreshed = await opts.jwksManager.getKeys({ forceRefresh: true });
    const m2 = kid ? refreshed.find((k) => (k as { kid?: string }).kid === kid) : refreshed[0];
    if (!m2) throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'no matching JWKS key');
    return m2;
  }

  return async function validateUserToken(input: ValidateUserTokenInput): Promise<UserContext> {
    return withSpan(SPAN_NAMES.TOKEN_VALIDATE, async () => {
      const token = input.token;
      const kid = readKid(token);
      const jwk = await findKey(kid);
      const key = await importJWK(jwk, (jwk as { alg?: string }).alg ?? 'RS256');
      let payload: Record<string, unknown>;
      let retried = false;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const v = await jwtVerify(token, key, { currentDate: new Date(now()) });
          payload = v.payload as Record<string, unknown>;
          break;
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'ERR_JWT_EXPIRED') {
            metrics.authFailureTotal.inc({ step: 'validateUserToken', error_code: ERROR_CODES.TOKEN_EXPIRED });
            throw new AuthError(401, ERROR_CODES.TOKEN_EXPIRED, 'token expired');
          }
          if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' && !retried) {
            retried = true;
            const refreshed = await opts.jwksManager.getKeys({ forceRefresh: true });
            const m = kid ? refreshed.find((k) => (k as { kid?: string }).kid === kid) : refreshed[0];
            if (m) {
              const refreshedKey = await importJWK(m, (m as { alg?: string }).alg ?? 'RS256');
              try {
                const v2 = await jwtVerify(token, refreshedKey, { currentDate: new Date(now()) });
                payload = v2.payload as Record<string, unknown>;
                break;
              } catch (e2) {
                const code2 = (e2 as { code?: string }).code;
                if (code2 === 'ERR_JWT_EXPIRED') {
                  metrics.authFailureTotal.inc({ step: 'validateUserToken', error_code: ERROR_CODES.TOKEN_EXPIRED });
                  throw new AuthError(401, ERROR_CODES.TOKEN_EXPIRED, 'token expired');
                }
                metrics.authFailureTotal.inc({ step: 'validateUserToken', error_code: ERROR_CODES.INVALID_TOKEN });
                throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'signature verification failed');
              }
            }
          }
          metrics.authFailureTotal.inc({ step: 'validateUserToken', error_code: ERROR_CODES.INVALID_TOKEN });
          throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'signature verification failed');
        }
      }

      const exp = Number(payload.exp ?? 0);
      const nowSec = Math.floor(now() / 1000);
      if (exp <= nowSec) {
        metrics.authFailureTotal.inc({ step: 'validateUserToken', error_code: ERROR_CODES.TOKEN_EXPIRED });
        throw new AuthError(401, ERROR_CODES.TOKEN_EXPIRED, 'token expired');
      }
      const iss = String(payload.iss ?? '');
      if (iss !== opts.expectedIssuer) {
        metrics.authFailureTotal.inc({ step: 'validateUserToken', error_code: ERROR_CODES.INVALID_TOKEN });
        throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'issuer mismatch');
      }
      if (!audienceMatches(payload.aud, opts.expectedAudience)) {
        metrics.authFailureTotal.inc({ step: 'validateUserToken', error_code: ERROR_CODES.INVALID_AUDIENCE });
        throw new AuthError(401, ERROR_CODES.INVALID_AUDIENCE, 'audience mismatch');
      }

      const roles = normaliseStringList(payload.roles);
      const groups = normaliseStringList(payload.groups);
      const claims = extractCustomClaims(payload);

      return {
        sub: String(payload.sub ?? ''),
        roles,
        groups,
        claims,
        issuer: iss,
      };
    });
  };
}
