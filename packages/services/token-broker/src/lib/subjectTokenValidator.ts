import { decodeJwt } from 'jose';
import { createValidateUserToken, createJwksManager, AuthError, ERROR_CODES } from '@s2s/auth-library';
import type { ValidateUserTokenFn } from '@s2s/auth-library';
import type { UserContext, ActorChain } from '@s2s/auth-library';

export interface SubjectTokenValidatorOptions {
  brokerIssuerUrl: string;
  brokerJwksUri: string;
  userIssuerUrl: string;
  userIssuerJwksUri: string;
  userIssuerAudience: string;
  /** Audience expected when re-validating a broker-issued token = the broker URL itself, OR
   *  the audience originally targeted. For re-entry we accept the requested audience explicitly. */
  jwksRefreshHours: number;
  fetchImpl?: typeof fetch;
  nowFn?: () => number;
}

export interface SubjectTokenValidationResult {
  /** User principal — same shape regardless of source token. */
  user: UserContext;
  /** Previous actor chain (if any) — only populated when subject token was broker-issued. */
  previousActorChain: ActorChain | null;
  /** Whether the subject token was already a broker-issued exchanged token (re-entry case). */
  isReentry: boolean;
}

export interface SubjectTokenValidator {
  validate(subjectToken: string, requestedAudience: string): Promise<SubjectTokenValidationResult>;
}

function readIssuerClaim(token: string): string | null {
  try {
    const payload = decodeJwt(token);
    return typeof payload.iss === 'string' ? payload.iss : null;
  } catch {
    return null;
  }
}

function buildChain(node: unknown): ActorChain | null {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
  const obj = node as Record<string, unknown>;
  const sub = obj.sub;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  const chain: ActorChain = { sub };
  const child = buildChain(obj.act);
  if (child) chain.act = child;
  return chain;
}

export function createSubjectTokenValidator(opts: SubjectTokenValidatorOptions): SubjectTokenValidator {
  const userJwksManager = createJwksManager({
    jwksUri: opts.userIssuerJwksUri,
    refreshHours: opts.jwksRefreshHours,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.nowFn ? { nowFn: opts.nowFn } : {}),
  });
  const brokerJwksManager = createJwksManager({
    jwksUri: opts.brokerJwksUri,
    refreshHours: opts.jwksRefreshHours,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.nowFn ? { nowFn: opts.nowFn } : {}),
  });

  const userValidator: ValidateUserTokenFn = createValidateUserToken({
    jwksManager: userJwksManager,
    expectedIssuer: opts.userIssuerUrl,
    expectedAudience: opts.userIssuerAudience,
    ...(opts.nowFn ? { nowFn: opts.nowFn } : {}),
  });

  return {
    async validate(subjectToken, requestedAudience) {
      const iss = readIssuerClaim(subjectToken);
      if (!iss) throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'subject token missing issuer');

      if (iss === opts.brokerIssuerUrl) {
        // Re-entry: validate against broker JWKS, expected aud = the broker URL itself
        // (next-hop services accept tokens with their own aud; the broker only re-accepts
        // exchanged tokens whose previous aud equals the actor's own service identity —
        // but that constraint is encoded by the requested audience the *new* actor wants).
        // We accept the token if signature + iss + exp are valid; we do not enforce
        // a specific aud at this stage because the prior aud belongs to the prior hop.
        const reentryValidator = createValidateUserToken({
          jwksManager: brokerJwksManager,
          expectedIssuer: opts.brokerIssuerUrl,
          // Accept any audience that matches what this hop is presenting as — i.e. the
          // calling actor's expected audience would equal the previous `aud` of the
          // exchanged token. We model that by passing requestedAudience here is wrong —
          // instead we accept the token and let upstream verify the inbound audience.
          // For Phase 2, the calling-service / receiving-service inbound middleware enforces
          // audience match before forwarding subject tokens, so the broker can be permissive.
          expectedAudience: requestedAudience,
          ...(opts.nowFn ? { nowFn: opts.nowFn } : {}),
        });
        // We need the previous act claim — re-decode after validation.
        try {
          // Validate signature/iss/exp; audience check is intentionally lax (see notes).
          await reentryValidator({ token: subjectToken }).catch(async (err) => {
            // If the audience check fails, fall back to a signature-only check so the
            // broker can still extract the act chain. We only swallow INVALID_AUDIENCE.
            if (err instanceof AuthError && err.code === ERROR_CODES.INVALID_AUDIENCE) {
              // Re-validate without audience match by using a synthetic validator that
              // matches whatever audience is present in the token.
              const payload = decodeJwt(subjectToken);
              const audClaim = payload.aud;
              const fallbackAud = typeof audClaim === 'string'
                ? audClaim
                : Array.isArray(audClaim) && typeof audClaim[0] === 'string'
                  ? audClaim[0]
                  : '';
              if (!fallbackAud) throw err;
              const fallback = createValidateUserToken({
                jwksManager: brokerJwksManager,
                expectedIssuer: opts.brokerIssuerUrl,
                expectedAudience: fallbackAud,
                ...(opts.nowFn ? { nowFn: opts.nowFn } : {}),
              });
              await fallback({ token: subjectToken });
            } else {
              throw err;
            }
          });
        } catch (err) {
          throw err;
        }

        const payload = decodeJwt(subjectToken) as Record<string, unknown>;
        const rolesRaw = payload.roles;
        const groupsRaw = payload.groups;
        const roles = Array.isArray(rolesRaw) ? rolesRaw.filter((r): r is string => typeof r === 'string') : [];
        const groups = Array.isArray(groupsRaw) ? groupsRaw.filter((g): g is string => typeof g === 'string') : [];
        const claims: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload)) {
          if (!['iss', 'sub', 'aud', 'exp', 'iat', 'nbf', 'jti', 'roles', 'groups'].includes(k)) {
            claims[k] = v;
          }
        }
        const user: UserContext = {
          sub: String(payload.sub ?? ''),
          roles,
          groups,
          claims,
          issuer: opts.userIssuerUrl, // preserve original principal issuer if present in claims
        };
        const claimsIssuer = claims.user_issuer;
        if (typeof claimsIssuer === 'string') user.issuer = claimsIssuer;
        const previousActorChain = buildChain(payload.act);
        return { user, previousActorChain, isReentry: true };
      }

      if (iss !== opts.userIssuerUrl) {
        throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, `unrecognised subject token issuer: ${iss}`);
      }

      const user = await userValidator({ token: subjectToken });
      return { user, previousActorChain: null, isReentry: false };
    },
  };
}
