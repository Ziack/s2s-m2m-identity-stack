import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthError, ERROR_CODES, buildErrorBody } from '@s2s/auth-library';
import type { ActorCatalog } from '../lib/actorCatalog.js';
import type { SigningKeyLoader } from '../lib/signingKeyLoader.js';
import type { SubjectTokenValidator } from '../lib/subjectTokenValidator.js';
import type { ReplayStore } from '../lib/replayStore.js';
import type { ExchangeProofVerifier } from '../lib/exchangeProofVerifier.js';
import { brokerTokenEndpointHtu } from '../lib/exchangeProofVerifier.js';
import type { BrokerMetrics } from './metrics.js';
import type { TokenBrokerConfig } from '../config.js';
import { mintExchangedToken } from '../lib/tokenMinter.js';
import { decodeJwt } from 'jose';

export interface TokenRouterDeps {
  config: TokenBrokerConfig;
  catalog: ActorCatalog;
  signingKey: SigningKeyLoader;
  subjectValidator: SubjectTokenValidator;
  replayStore: ReplayStore;
  /**
   * Verifies the DPoP proof on the exchange request (no `ath`) and yields the
   * proof key thumbprint the minted token is bound to via `cnf.jkt`.
   */
  proofVerifier: ExchangeProofVerifier;
  metrics: BrokerMetrics;
}

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ISSUED_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
const SUPPORTED_SUBJECT_TOKEN_TYPES = new Set([
  'urn:ietf:params:oauth:token-type:access_token',
  'urn:ietf:params:oauth:token-type:jwt',
]);

interface TokenExchangeErrorBody {
  error: string;
  error_description: string;
  request_id: string;
}

function oauthError(
  res: Response,
  status: number,
  code: string,
  description: string,
  requestId: string,
): void {
  const body: TokenExchangeErrorBody = {
    error: code,
    error_description: description,
    request_id: requestId,
  };
  res.status(status).json(body);
}

function parseBasicAuth(header: string | undefined): { clientId: string; secret: string } | null {
  if (!header || !header.startsWith('Basic ')) return null;
  const encoded = header.slice('Basic '.length).trim();
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  const clientId = decoded.slice(0, idx);
  const secret = decoded.slice(idx + 1);
  if (!clientId || !secret) return null;
  return { clientId, secret };
}

function getStringField(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseScopes(raw: string): string[] {
  return raw.split(/\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function tokenRouter(deps: TokenRouterDeps): Router {
  const router = Router();
  router.post('/oauth2/token', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    res.setHeader('x-request-id', requestId);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('pragma', 'no-cache');

    const endTimer = deps.metrics.exchangeDuration.startTimer();
    let outcome = 'ok';
    let reentry = 'false';

    try {
      // 1. Parse and require fields
      const grantType = getStringField(req.body, 'grant_type');
      if (grantType !== GRANT_TYPE) {
        outcome = 'unsupported_grant_type';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'unsupported_grant_type' });
        endTimer({ outcome, reentry });
        oauthError(res, 400, 'unsupported_grant_type', `expected grant_type=${GRANT_TYPE}`, requestId);
        return;
      }
      const subjectToken = getStringField(req.body, 'subject_token');
      const subjectTokenType = getStringField(req.body, 'subject_token_type');
      const audience = getStringField(req.body, 'audience');
      const scopeRaw = getStringField(req.body, 'scope');
      if (!subjectToken || !subjectTokenType || !audience || !scopeRaw) {
        outcome = 'invalid_request';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'invalid_request' });
        endTimer({ outcome, reentry });
        oauthError(
          res,
          400,
          'invalid_request',
          'subject_token, subject_token_type, audience, and scope are required',
          requestId,
        );
        return;
      }
      if (!SUPPORTED_SUBJECT_TOKEN_TYPES.has(subjectTokenType)) {
        outcome = 'invalid_request';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'unsupported_subject_token_type' });
        endTimer({ outcome, reentry });
        oauthError(res, 400, 'invalid_request', `unsupported subject_token_type: ${subjectTokenType}`, requestId);
        return;
      }
      const requestedScopes = parseScopes(scopeRaw);
      if (requestedScopes.length === 0) {
        outcome = 'invalid_scope';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'invalid_scope' });
        endTimer({ outcome, reentry });
        oauthError(res, 400, 'invalid_scope', 'scope must not be empty', requestId);
        return;
      }

      // 2. Authenticate actor
      const basic = parseBasicAuth(req.headers.authorization);
      if (!basic) {
        outcome = 'invalid_client';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'invalid_client' });
        endTimer({ outcome, reentry });
        res.setHeader('www-authenticate', 'Basic realm="token-broker"');
        oauthError(res, 401, 'invalid_client', 'client_secret_basic authentication required', requestId);
        return;
      }
      const actorEntry = deps.catalog.get(basic.clientId);
      if (!actorEntry || !deps.catalog.authenticate(basic.clientId, basic.secret)) {
        outcome = 'invalid_client';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'invalid_client' });
        endTimer({ outcome, reentry });
        res.setHeader('www-authenticate', 'Basic realm="token-broker"');
        oauthError(res, 401, 'invalid_client', 'unknown client or bad credentials', requestId);
        return;
      }

      // 2b. Verify the exchange-request DPoP proof (RFC 9449). The proof
      // conveys + proves the caller's DPoP key; its thumbprint becomes the
      // minted token's cnf.jkt (re-binds per hop). No `ath` — no access token
      // is presented on the exchange request. Hard-enforced: the broker now
      // REQUIRES a proof on every exchange.
      const proofHeader = req.headers['dpop'];
      const dpopProof = Array.isArray(proofHeader) ? proofHeader[0] : proofHeader;
      if (!dpopProof) {
        outcome = 'invalid_dpop_proof';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'invalid_dpop_proof' });
        endTimer({ outcome, reentry });
        oauthError(res, 400, 'invalid_dpop_proof', 'DPoP proof header is required on the exchange request', requestId);
        return;
      }
      let proofThumbprint: string;
      try {
        const expectedHtu = brokerTokenEndpointHtu(req);
        const proofResult = await deps.proofVerifier.verify(dpopProof, expectedHtu);
        proofThumbprint = proofResult.jwkThumbprint;
      } catch (err) {
        outcome = 'invalid_dpop_proof';
        const code = err instanceof AuthError ? err.code : 'invalid_dpop_proof';
        const status = err instanceof AuthError ? err.status : 401;
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: code });
        endTimer({ outcome, reentry });
        oauthError(
          res,
          status,
          'invalid_dpop_proof',
          err instanceof Error ? err.message : 'invalid DPoP proof',
          requestId,
        );
        return;
      }

      // 3. Validate subject token (auto-discriminate user vs broker)
      let validated;
      try {
        validated = await deps.subjectValidator.validate(subjectToken, audience);
      } catch (err) {
        outcome = 'invalid_token';
        const code = err instanceof AuthError ? err.code : ERROR_CODES.INVALID_TOKEN;
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: code });
        endTimer({ outcome, reentry });
        oauthError(res, 401, 'invalid_token', err instanceof Error ? err.message : 'invalid subject_token', requestId);
        return;
      }
      reentry = validated.isReentry ? 'true' : 'false';

      // 4. Audience authorization
      if (!actorEntry.allowed_audiences.includes(audience)) {
        outcome = 'invalid_target';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'invalid_target' });
        endTimer({ outcome, reentry });
        oauthError(res, 403, 'invalid_target', `actor ${basic.clientId} cannot target ${audience}`, requestId);
        return;
      }

      // 5. Scope authorization
      const deniedScopes = requestedScopes.filter((s) => !actorEntry.allowed_scopes.includes(s));
      if (deniedScopes.length > 0) {
        outcome = 'invalid_scope';
        deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'invalid_scope' });
        endTimer({ outcome, reentry });
        oauthError(
          res,
          400,
          'invalid_scope',
          `actor ${basic.clientId} not permitted scopes: ${deniedScopes.join(',')}`,
          requestId,
        );
        return;
      }

      // 6. Mint
      const { privateKey, kid } = await deps.signingKey.get();
      const token = await mintExchangedToken(
        {
          privateKey,
          kid,
          issuer: deps.config.brokerIssuerUrl,
          ttlSeconds: deps.config.exchangedTokenTtlSeconds,
        },
        {
          user: validated.user,
          audience,
          scopes: requestedScopes,
          actorClientId: basic.clientId,
          previousActorChain: validated.previousActorChain,
          // cnf.jkt binds to THIS exchange request's proof key (re-binds per
          // hop), NOT the inbound token's cnf.
          confirmationJkt: proofThumbprint,
        },
      );

      // 7. Replay check on freshly-issued jti
      const decoded = decodeJwt(token);
      const jti = typeof decoded.jti === 'string' ? decoded.jti : null;
      if (jti) {
        const claimed = await deps.replayStore.claim(jti);
        if (!claimed) {
          deps.metrics.jtiReplayTotal.inc({ actor: basic.clientId });
          outcome = 'invalid_token';
          deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: ERROR_CODES.INVALID_TOKEN });
          endTimer({ outcome, reentry });
          oauthError(res, 401, 'invalid_token', 'jti replay detected', requestId);
          return;
        }
      }

      const tokenType = deps.config.dpopRequired ? 'DPoP' : 'Bearer';
      deps.metrics.exchangeOutcomeTotal.inc({ outcome: 'ok', error_code: 'none' });
      endTimer({ outcome: 'ok', reentry });
      res.status(200).json({
        access_token: token,
        issued_token_type: ISSUED_TOKEN_TYPE,
        token_type: tokenType,
        expires_in: deps.config.exchangedTokenTtlSeconds,
        scope: requestedScopes.join(' '),
      });
    } catch (err) {
      outcome = 'server_error';
      deps.metrics.exchangeOutcomeTotal.inc({ outcome, error_code: 'server_error' });
      endTimer({ outcome, reentry });
      const body = buildErrorBody({
        code: ERROR_CODES.INVALID_TOKEN,
        description: err instanceof Error ? err.message : 'internal error',
        requestId,
      });
      res.status(500).json({ ...body, error: 'server_error' });
    }
  });
  return router;
}
