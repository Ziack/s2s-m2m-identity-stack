import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  postLedgerEntry,
  LedgerOutboundError,
  toHttpsBaseUrl,
  __setExchangeFn,
  __setFetchImpl,
  __resetLedgerClient,
} from '../src/lib/ledgerClient.js';
import { __setLatticeFetchForTest } from '../src/lib/latticeFetch.js';

describe('toHttpsBaseUrl', () => {
  it('upgrades http:// to https:// so the signed htu matches the receiver scheme', () => {
    expect(toHttpsBaseUrl('http://ledger.internal')).toBe('https://ledger.internal');
  });
  it('passes https:// through unchanged', () => {
    expect(toHttpsBaseUrl('https://ledger.internal')).toBe('https://ledger.internal');
  });
  it('defaults a schemeless host to https://', () => {
    expect(toHttpsBaseUrl('ledger.internal')).toBe('https://ledger.internal');
  });
  it('passes empty string through unchanged', () => {
    expect(toHttpsBaseUrl('')).toBe('');
  });
});

const signedProofs: string[] = [];
const signedNonces: Array<string | undefined> = [];

vi.mock('@s2s/auth-library', () => ({
  signDPoP: vi.fn(async (opts: { nonce?: string }) => {
    const proof = `proof-${signedProofs.length + 1}${opts.nonce ? `-with-nonce-${opts.nonce}` : ''}`;
    signedProofs.push(proof);
    signedNonces.push(opts.nonce);
    return { proof, jti: `jti-${signedProofs.length}` };
  }),
  // The real ledgerClient calls `createExchangeToken` only if no exchangeFn is
  // preset via `__setExchangeFn`. Tests inject a double directly.
  createExchangeToken: () => async () => ({ accessToken: 'tok-default', expiresAt: 0, tokenType: 'DPoP', issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token', scopes: ['ledger/write'] }),
  getClientSecret: vi.fn(async () => JSON.stringify({ client_secret: 'shh' })),
  // Lattice surface consumed by src/lib/latticeFetch.ts. createLatticeFetch is
  // unused in tests (we inject via __setLatticeFetchForTest), but must exist.
  createLatticeFetch: () => async () => new Response('{}', { status: 200 }),
  DPOP_TOKEN_HEADER: 'X-DPoP-Token',
}));

const cfg = {
  port: 3000,
  expectedAudience: 'lending',
  expectedIssuer: 'https://issuer',
  jwksUri: 'https://issuer/.well-known/jwks.json',
  jwksRefreshHours: 1,
  nonceTtlSeconds: 120,
  policyStoreId: 'ps-1',
  resourcePrefix: 'lending',
  queueUrl: 'x',
  queueArn: 'x',
  redisEndpoint: 'redis://localhost:6379',
  awsRegion: 'us-east-1',
  logLevel: 'silent',
  ledgerServiceUrl: 'http://ledger.local',
  ledgerOutboundClientId: 'receiving-service-outbound',
  ledgerOutboundSecretArn: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:m2m/recv/client-secret',
  ledgerOutboundEnabled: true,
  cognitoDomain: 'example',
  brokerJwksUri: 'http://broker/jwks',
  brokerIssuer: 'http://broker',
  brokerAudience: 'receiving',
  brokerTokenEndpoint: 'http://broker/oauth2/token',
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('postLedgerEntry', () => {
  beforeEach(() => {
    signedProofs.length = 0;
    signedNonces.length = 0;
    delete process.env.USE_LATTICE;
    __resetLedgerClient();
  });

  it('exchanges subjectToken at broker, signs DPoP, and POSTs with exchanged-token headers', async () => {
    const exchange = vi.fn(async (input: { subjectToken: string }) => ({
      accessToken: `exchanged-for-${input.subjectToken}`,
      expiresAt: 0,
      tokenType: 'DPoP' as const,
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scopes: ['ledger/write'],
    }));
    __setExchangeFn(exchange);
    const fetchMock = vi.fn(async () => jsonResponse(201, { entryId: 'E-1', status: 'committed' }));
    __setFetchImpl(fetchMock as unknown as typeof fetch);

    const result = await postLedgerEntry(cfg, {
      correlationId: 'corr-1',
      payload: { loanId: 'L-aaa', amount: 100 },
      subjectToken: 'inbound-token-abc',
    });

    expect(result).toEqual({ entryId: 'E-1', status: 'committed' });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith({ subjectToken: 'inbound-token-abc' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    // ALB-mode base URL is normalized to https so the signed htu matches the
    // scheme the receiver computes behind the ALB (X-Forwarded-Proto).
    expect(url).toBe('https://ledger.local/api/ledger/entries');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('DPoP exchanged-for-inbound-token-abc');
    expect(headers.dpop).toBe('proof-1');
    expect(headers['x-correlation-id']).toBe('corr-1');
    expect(headers['content-type']).toBe('application/json');
    expect((init as RequestInit).body).toBe(JSON.stringify({ loanId: 'L-aaa', amount: 100 }));
  });

  it('Lattice mode: SigV4-signs to ledger Lattice DNS with token in X-DPoP-Token', async () => {
    process.env.USE_LATTICE = 'true';
    __setExchangeFn(async () => ({
      accessToken: 'tok-lattice', expiresAt: 0, tokenType: 'DPoP' as const,
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token', scopes: ['ledger/write'],
    }));
    const latticeMock = vi.fn(async () => jsonResponse(201, { entryId: 'E-L', status: 'committed' }));
    __setLatticeFetchForTest(latticeMock as never);
    const plainFetch = vi.fn(async () => jsonResponse(500, {}));
    __setFetchImpl(plainFetch as unknown as typeof fetch);

    const latticeCfg = { ...cfg, ledgerLatticeDns: 'ledger-xyz.vpc-lattice-svcs.us-east-1.on.aws' };
    const result = await postLedgerEntry(latticeCfg, {
      correlationId: 'corr-L',
      payload: { loanId: 'L-lat' },
      subjectToken: 'inbound-lat',
    });

    expect(result.entryId).toBe('E-L');
    expect(plainFetch).not.toHaveBeenCalled();
    expect(latticeMock).toHaveBeenCalledTimes(1);
    const sent = latticeMock.mock.calls[0]![0] as { url: string; method: string; headers: Record<string, string> };
    expect(sent.url).toBe('https://ledger-xyz.vpc-lattice-svcs.us-east-1.on.aws/api/ledger/entries');
    expect(sent.headers['X-DPoP-Token']).toBe('tok-lattice');
    expect(sent.headers.authorization).toBeUndefined();
    expect(sent.headers.dpop).toBe('proof-1');
  });

  it('throws if subjectToken is missing — cannot propagate user identity', async () => {
    __setExchangeFn(async () => ({
      accessToken: 'whatever', expiresAt: 0, tokenType: 'DPoP' as const,
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token', scopes: [],
    }));
    await expect(
      postLedgerEntry(cfg, { correlationId: 'corr-x', payload: {} }),
    ).rejects.toBeInstanceOf(LedgerOutboundError);
  });

  it('retries once on 401 with DPoP-Nonce header echoed back', async () => {
    __setExchangeFn(async () => ({
      accessToken: 'tok-xyz', expiresAt: 0, tokenType: 'DPoP' as const,
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token', scopes: [],
    }));
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
          status: 401,
          headers: { 'dpop-nonce': 'NONCE-7', 'content-type': 'application/json' },
        });
      }
      return jsonResponse(201, { entryId: 'E-2', status: 'committed' });
    });
    __setFetchImpl(fetchMock as unknown as typeof fetch);

    const result = await postLedgerEntry(cfg, {
      correlationId: 'corr-2',
      payload: { loanId: 'L-b' },
      subjectToken: 'inbound-2',
    });
    expect(result.entryId).toBe('E-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signedNonces).toEqual([undefined, 'NONCE-7']);
  });

  it('throws LedgerOutboundError on 500 after retry exhausted', async () => {
    __setExchangeFn(async () => ({
      accessToken: 'tok', expiresAt: 0, tokenType: 'DPoP' as const,
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token', scopes: [],
    }));
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    __setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(
      postLedgerEntry(cfg, { correlationId: 'corr-3', payload: {}, subjectToken: 'tok-in' }),
    ).rejects.toBeInstanceOf(LedgerOutboundError);
  });

  it('does not retry on non-401 4xx errors', async () => {
    __setExchangeFn(async () => ({
      accessToken: 'tok', expiresAt: 0, tokenType: 'DPoP' as const,
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token', scopes: [],
    }));
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    __setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(
      postLedgerEntry(cfg, { correlationId: 'corr-4', payload: {}, subjectToken: 'tok-in' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
