import { AuthError, ERROR_CODES } from '../errors.js';
import { signDPoP } from '../dpop/signDPoP.js';

/**
 * Options for the RFC 8693 token-exchange factory.
 *
 * Authentication to the broker uses `client_secret_basic` (HTTP Basic auth with
 * `actorClientId:actorClientSecret`). This intentionally avoids the canonical
 * RFC 8693 pattern of passing a separate `actor_token` (which would require an
 * extra round-trip to obtain an actor-bearer-token), and instead matches the
 * Microsoft Identity Platform behaviour: the actor is identified by Basic auth,
 * and the broker is expected to mint the resulting access token with an `act`
 * claim of `{ sub: actorClientId }` (or extend any existing `act` chain).
 *
 * A non-standard `requested_token_use=on_behalf_of` parameter is included so
 * brokers that understand the MS-style flag can short-circuit to the OBO path.
 */
export interface ExchangeTokenOptions {
  /** Broker token endpoint, e.g. `https://broker/oauth2/token`. */
  brokerUrl: string;
  /** Actor (calling-service) client_id. Used in Basic auth and surfaces in the act chain. */
  actorClientId: string;
  /** Actor client_secret. Static string, or an async loader (e.g. Secrets Manager). */
  actorClientSecret: string | (() => Promise<string>);
  /** Default downstream audience. Can be overridden per-call. */
  audience: string;
  /** Default downstream scopes. Can be overridden per-call. */
  scope: string[];
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Produces the DPoP proof attached as the `DPoP:` header on the exchange
   * request. The proof conveys the caller's DPoP public key (embedded `jwk`)
   * and proves possession; Phase 2 the broker verifies it and mints the access
   * token with `cnf: { jkt }` equal to this key's thumbprint.
   *
   * Receives the broker token endpoint as `htu`; must sign with `htm: "POST"`.
   * No `ath` is set (no access token is presented on the exchange request).
   *
   * Defaults to using the process DPoP key (`keyManager` via `signDPoP`).
   * Injectable for tests. Returns the compact-JWS proof string.
   */
  dpopProofSigner?: (input: { htm: string; htu: string }) => Promise<string>;
}

export interface ExchangeTokenInput {
  /** The subject token — user JWT, or an upstream exchanged token to extend the act chain. */
  subjectToken: string;
  /** Defaults to `urn:ietf:params:oauth:token-type:access_token`. */
  subjectTokenType?: string;
  /** Per-call override of the broker `audience` param. */
  audience?: string;
  /** Per-call override of the broker `scope` param. */
  scope?: string[];
}

export interface ExchangeTokenResult {
  accessToken: string;
  expiresAt: number;
  tokenType: 'DPoP' | 'Bearer';
  issuedTokenType: string;
  scopes: string[];
}

export type ExchangeTokenFn = (input: ExchangeTokenInput) => Promise<ExchangeTokenResult>;

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const DEFAULT_SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const DEFAULT_ISSUED_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

interface BrokerTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  issued_token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function normaliseTokenType(value: string | undefined): 'DPoP' | 'Bearer' {
  if (typeof value === 'string' && value.toLowerCase() === 'dpop') return 'DPoP';
  return 'Bearer';
}

async function resolveSecret(secret: string | (() => Promise<string>)): Promise<string> {
  return typeof secret === 'function' ? secret() : secret;
}

const defaultDpopProofSigner = async (input: { htm: string; htu: string }): Promise<string> => {
  const { proof } = await signDPoP({ htm: input.htm, htu: input.htu });
  return proof;
};

export function createExchangeToken(opts: ExchangeTokenOptions): ExchangeTokenFn {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const dpopProofSigner = opts.dpopProofSigner ?? defaultDpopProofSigner;

  return async function exchangeToken(input: ExchangeTokenInput): Promise<ExchangeTokenResult> {
    const audience = input.audience ?? opts.audience;
    const scope = input.scope ?? opts.scope;
    const subjectTokenType = input.subjectTokenType ?? DEFAULT_SUBJECT_TOKEN_TYPE;

    const body = new URLSearchParams();
    body.set('grant_type', GRANT_TYPE);
    body.set('subject_token', input.subjectToken);
    body.set('subject_token_type', subjectTokenType);
    body.set('audience', audience);
    if (scope.length > 0) body.set('scope', scope.join(' '));
    body.set('requested_token_use', 'on_behalf_of');

    const secret = await resolveSecret(opts.actorClientSecret);
    const basic = Buffer.from(`${opts.actorClientId}:${secret}`).toString('base64');

    // DPoP proof conveys the caller's public key (so the broker can mint
    // cnf:{jkt}) and proves key possession. Does not collide with the Basic
    // actor credential — this is the control plane, no SigV4 here.
    const dpopProof = await dpopProofSigner({ htm: 'POST', htu: opts.brokerUrl });

    let res: Response;
    try {
      res = await fetchImpl(opts.brokerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          authorization: `Basic ${basic}`,
          DPoP: dpopProof,
        },
        body: body.toString(),
      });
    } catch (e) {
      throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, `broker request failed: ${(e as Error).message}`);
    }

    let parsed: BrokerTokenResponse;
    try {
      parsed = (await res.json()) as BrokerTokenResponse;
    } catch {
      parsed = {};
    }

    if (res.status >= 500) {
      const desc = parsed.error_description ?? `broker upstream ${res.status}`;
      throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, desc, {
        details: { upstream: res.status },
      });
    }

    if (!res.ok) {
      const desc = parsed.error_description ?? parsed.error ?? `broker returned ${res.status}`;
      throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, desc);
    }

    if (!parsed.access_token) {
      throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'broker response missing access_token');
    }

    const expiresInSec = typeof parsed.expires_in === 'number' ? parsed.expires_in : 0;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSec;
    const issuedTokenType = parsed.issued_token_type ?? DEFAULT_ISSUED_TOKEN_TYPE;
    const scopeStr = parsed.scope ?? '';
    const scopes = scopeStr.length > 0 ? scopeStr.split(/\s+/) : scope;

    return {
      accessToken: parsed.access_token,
      expiresAt,
      tokenType: normaliseTokenType(parsed.token_type),
      issuedTokenType,
      scopes,
    };
  };
}
