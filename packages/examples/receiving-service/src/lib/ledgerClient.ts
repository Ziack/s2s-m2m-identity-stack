/**
 * Outbound client used by receiving-service to call the downstream ledger
 * service. Each hop in `calling → receiving → ledger` is an independent OAuth
 * client (DPoP is sender-constrained, so tokens cannot be forwarded).
 *
 * Module-scoped lazy initialization caches a single `createAcquireToken`
 * instance to amortise the Secrets Manager fetch + breaker construction.
 */
import {
  signDPoP,
  createAcquireToken,
  TokenCache,
  getRedisClient,
  getClientSecret,
  buildBreaker,
} from '@s2s/auth-library';
import type { TokenResult } from '@s2s/auth-library';
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

type AcquireFn = (clientId: string, scopes: string[]) => Promise<TokenResult>;

let acquireFn: AcquireFn | null = null;
let configRef: ReceivingServiceConfig | null = null;
let fetchImpl: typeof fetch = fetch;

/** Test seam — replace the cached acquireToken function. */
export function __setAcquireFn(fn: AcquireFn | null): void {
  acquireFn = fn;
}

/** Test seam — replace the fetch implementation. */
export function __setFetchImpl(impl: typeof fetch): void {
  fetchImpl = impl;
}

/** Test seam — reset module state between tests. */
export function __resetLedgerClient(): void {
  acquireFn = null;
  configRef = null;
  fetchImpl = fetch;
}

async function ensureAcquire(config: ReceivingServiceConfig): Promise<AcquireFn> {
  if (acquireFn) return acquireFn;
  configRef = config;
  const secretJson = await getClientSecret(config.ledgerOutboundSecretArn, config.awsRegion);
  let clientSecret: string;
  try {
    const parsed = JSON.parse(secretJson) as { client_secret?: string };
    clientSecret = parsed.client_secret ?? secretJson;
  } catch {
    clientSecret = secretJson;
  }
  const redis = getRedisClient(config.redisEndpoint);
  const cache = new TokenCache({ redis });
  const breaker = buildBreaker('cognito-ledger-outbound', {
    failureThreshold: 5,
    halfOpenAfterMs: 30_000,
    samplingDurationMs: 60_000,
  });
  const cognitoDomain = config.cognitoDomain.startsWith('http')
    ? config.cognitoDomain
    : `https://${config.cognitoDomain}.auth.${config.awsRegion}.amazoncognito.com`;
  const fn = createAcquireToken({ cognitoDomain, clientSecret, cache, breaker });
  acquireFn = (clientId, scopes) => fn(clientId, scopes);
  return acquireFn;
}

export interface PostLedgerEntryArgs {
  correlationId: string;
  payload: Record<string, unknown>;
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
  const acquire = await ensureAcquire(config);
  const token = await acquire(config.ledgerOutboundClientId, ['ledger/write']);
  const htu = `${config.ledgerServiceUrl}/api/ledger/entries`;

  async function attempt(nonce?: string): Promise<Response> {
    const dpopOpts: { accessToken: string; htm: string; htu: string; nonce?: string } = {
      accessToken: token.accessToken,
      htm: 'POST',
      htu,
    };
    if (nonce) dpopOpts.nonce = nonce;
    const dpop = await signDPoP(dpopOpts);
    return fetchImpl(htu, {
      method: 'POST',
      headers: {
        'authorization': `DPoP ${token.accessToken}`,
        'dpop': dpop.proof,
        'x-correlation-id': args.correlationId,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args.payload),
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
