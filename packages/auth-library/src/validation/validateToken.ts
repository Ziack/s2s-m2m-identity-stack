import { jwtVerify, importJWK, type JWK } from 'jose';
import { AuthError, ERROR_CODES } from '../errors.js';
import type { JwksManager } from './jwksManager.js';
import type { ValidatedToken } from '../types.js';
import { metrics } from '../observability/metrics.js';
import { withSpan, SPAN_NAMES } from '../observability/tracing.js';

export interface ValidateTokenDeps {
  jwksManager: JwksManager;
  expectedIssuer: string;
  nowFn?: () => number;
}

export interface ValidateTokenOptions {
  expectedAudience: string;
}

export type ValidateTokenFn = (token: string, options: ValidateTokenOptions) => Promise<ValidatedToken>;

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

export function createValidateToken(deps: ValidateTokenDeps): ValidateTokenFn {
  const now = deps.nowFn ?? Date.now;

  async function findKey(kid: string | null): Promise<JWK> {
    const keys = await deps.jwksManager.getKeys();
    const match = kid ? keys.find((k) => (k as { kid?: string }).kid === kid) : keys[0];
    if (match) return match;
    const refreshed = await deps.jwksManager.getKeys({ forceRefresh: true });
    const m2 = kid ? refreshed.find((k) => (k as { kid?: string }).kid === kid) : refreshed[0];
    if (!m2) throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'no matching JWKS key');
    return m2;
  }

  return async function validate(token: string, options: ValidateTokenOptions): Promise<ValidatedToken> {
    return withSpan(SPAN_NAMES.TOKEN_VALIDATE, async () => {
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
            metrics.authFailureTotal.inc({ step: 'validateToken', error_code: ERROR_CODES.TOKEN_EXPIRED });
            throw new AuthError(401, ERROR_CODES.TOKEN_EXPIRED, 'token expired');
          }
          if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' && !retried) {
            retried = true;
            // Possible stale JWKS: force-refresh and retry verification once.
            const refreshed = await deps.jwksManager.getKeys({ forceRefresh: true });
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
                  metrics.authFailureTotal.inc({ step: 'validateToken', error_code: ERROR_CODES.TOKEN_EXPIRED });
                  throw new AuthError(401, ERROR_CODES.TOKEN_EXPIRED, 'token expired');
                }
                metrics.authFailureTotal.inc({ step: 'validateToken', error_code: ERROR_CODES.INVALID_TOKEN });
                throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'signature verification failed');
              }
            }
          }
          metrics.authFailureTotal.inc({ step: 'validateToken', error_code: ERROR_CODES.INVALID_TOKEN });
          throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'signature verification failed');
        }
      }
      const exp = Number(payload.exp ?? 0);
      const nowSec = Math.floor(now() / 1000);
      if (exp <= nowSec) {
        metrics.authFailureTotal.inc({ step: 'validateToken', error_code: ERROR_CODES.TOKEN_EXPIRED });
        throw new AuthError(401, ERROR_CODES.TOKEN_EXPIRED, 'token expired');
      }
      const aud = String(payload.aud ?? '');
      if (aud !== options.expectedAudience) {
        metrics.authFailureTotal.inc({ step: 'validateToken', error_code: ERROR_CODES.INVALID_AUDIENCE });
        throw new AuthError(401, ERROR_CODES.INVALID_AUDIENCE, 'audience mismatch');
      }
      const iss = String(payload.iss ?? '');
      if (iss !== deps.expectedIssuer) {
        throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'issuer mismatch');
      }
      const scopeStr = String(payload.scope ?? '');
      return {
        sub: String(payload.sub ?? ''),
        scope: scopeStr.length > 0 ? scopeStr.split(' ') : [],
        iss,
        aud,
        exp,
        raw: payload,
      };
    });
  };
}
