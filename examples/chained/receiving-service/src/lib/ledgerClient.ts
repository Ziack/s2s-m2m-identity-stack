/**
 * Outbound client used by receiving-service to call the downstream ledger
 * service. Each hop in `calling → receiving → ledger` is an independent OAuth
 * client; tokens are not forwarded (DPoP is sender-constrained), but the
 * **identity** propagates through RFC 8693 token-exchange at the broker.
 *
 * Phase 4: the previous client_credentials `acquireToken` path is replaced
 * with `exchangeToken({ subjectToken: <inbound token> })` so the user's `sub`
 * and the accumulated `act` chain reach the ledger. The broker mints a token
 * with `sub = <user>, act = { sub: 'receiving-service-outbound', act: { sub:
 * 'calling-service' } }`, which the ledger validates against the broker JWKS
 * and consumes via its broker-aware middleware.
 *
 * Module-scoped lazy initialization caches a single `ExchangeTokenFn`
 * instance to amortise the Secrets Manager fetch.
 */
import {
  signDPoP,
  createExchangeToken,
  getClientSecret,
  DPOP_TOKEN_HEADER,
  type ExchangeTokenFn,
  type ExchangeTokenResult,
} from '@s2s/auth-library';
import { getLatticeFetch, useLattice, __setLatticeFetchForTest } from './latticeFetch.js';
import type { ReceivingServiceConfig } from '../config.js';

export class LedgerOutboundError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `ledger outbound failed: HTTP ${status}`);
    this.name = 'LedgerOutboundError';
    this.status = status;
    this.body = body;
  }
}

let exchangeFn: ExchangeTokenFn | null = null;
let configRef: ReceivingServiceConfig | null = null;
let fetchImpl: typeof fetch = fetch;

/** Test seam — replace the cached exchangeToken function. */
export function __setExchangeFn(fn: ExchangeTokenFn | null): void {
  exchangeFn = fn;
}

/** Test seam — replace the fetch implementation. */
export function __setFetchImpl(impl: typeof fetch): void {
  fetchImpl = impl;
}

/** Test seam — reset module state between tests. */
export function __resetLedgerClient(): void {
  exchangeFn = null;
  configRef = null;
  fetchImpl = fetch;
  __setLatticeFetchForTest(null);
}

async function ensureExchange(config: ReceivingServiceConfig): Promise<ExchangeTokenFn> {
  if (exchangeFn) return exchangeFn;
  configRef = config;
  // Control plane: the broker token-exchange ALWAYS uses the broker's ALB
  // endpoint with `client_secret_basic` (Authorization: Basic ...), in BOTH
  // Lattice and non-Lattice modes. SigV4 (Lattice data plane) also owns the
  // Authorization header, so routing the exchange over Lattice would clobber the
  // Basic credential and the frozen broker would reject it. Only the data-plane
  // hop (receiving → ledger) rides Lattice+SigV4; see postLedgerEntry below.
  exchangeFn = createExchangeToken({
    brokerUrl: config.brokerTokenEndpoint,
    actorClientId: config.ledgerOutboundClientId,
    actorClientSecret: async () => {
      const raw = await getClientSecret(config.ledgerOutboundSecretArn, config.awsRegion);
      try {
        const parsed = JSON.parse(raw) as { client_secret?: string };
        return parsed.client_secret ?? raw;
      } catch {
        return raw;
      }
    },
    audience: 'ledger',
    scope: ['ledger/write'],
  });
  return exchangeFn;
}

export interface PostLedgerEntryArgs {
  correlationId: string;
  payload: Record<string, unknown>;
  /**
   * Inbound subject token (validated broker-issued token from the caller).
   * Required for RFC 8693 token-exchange; if absent we cannot propagate the
   * user identity and the outbound call must fail loudly rather than fall
   * back to anonymous M2M.
   */
  subjectToken?: string;
}

export interface LedgerEntryResponse {
  entryId: string;
  status: string;
  [k: string]: unknown;
}

/**
 * POST a ledger entry over DPoP. Handles the standard once-only nonce retry
 * loop: an initial 401 with a `DPoP-Nonce` response header triggers a single
 * re-sign with the echoed nonce. Any non-2xx after retry raises
 * LedgerOutboundError.
 */
export async function postLedgerEntry(
  config: ReceivingServiceConfig,
  args: PostLedgerEntryArgs,
): Promise<LedgerEntryResponse> {
  if (!args.subjectToken) {
    throw new LedgerOutboundError(
      400,
      '',
      'ledger outbound requires subjectToken (inbound broker-issued token)',
    );
  }
  const exchange = await ensureExchange(config);
  const exchanged: ExchangeTokenResult = await exchange({ subjectToken: args.subjectToken });
  // Lattice mode: target ledger's Lattice DNS so SigV4 + DPoP htu both bind to
  // the Lattice URL; otherwise the ALB service URL (legacy path).
  const lattice = useLattice() && !!config.ledgerLatticeDns;
  const ledgerBase = lattice ? `https://${config.ledgerLatticeDns}` : config.ledgerServiceUrl;
  const htu = `${ledgerBase}/api/ledger/entries`;
  const body = JSON.stringify(args.payload);

  async function attempt(nonce?: string): Promise<Response> {
    const dpopOpts: { accessToken: string; htm: string; htu: string; nonce?: string } = {
      accessToken: exchanged.accessToken,
      htm: 'POST',
      htu,
    };
    if (nonce) dpopOpts.nonce = nonce;
    const dpop = await signDPoP(dpopOpts);
    const baseHeaders: Record<string, string> = {
      'dpop': dpop.proof,
      'x-correlation-id': args.correlationId,
      'content-type': 'application/json',
    };
    if (lattice) {
      // SigV4 owns Authorization; DPoP-bound token rides in X-DPoP-Token.
      return getLatticeFetch(config.awsRegion)({
        url: htu,
        method: 'POST',
        headers: { ...baseHeaders, [DPOP_TOKEN_HEADER]: exchanged.accessToken },
        body,
      });
    }
    return fetchImpl(htu, {
      method: 'POST',
      headers: { ...baseHeaders, 'authorization': `DPoP ${exchanged.accessToken}` },
      body,
    });
  }

  let response = await attempt();
  if (response.status === 401) {
    const nonce = response.headers.get('dpop-nonce');
    if (nonce) {
      response = await attempt(nonce);
    }
  }

  if (response.status < 200 || response.status >= 300) {
    const bodyText = await response.text().catch(() => '');
    throw new LedgerOutboundError(response.status, bodyText);
  }

  const json = (await response.json()) as LedgerEntryResponse;
  return json;
}

// Silence unused warning — configRef is held for debugging/observability.
void configRef;
