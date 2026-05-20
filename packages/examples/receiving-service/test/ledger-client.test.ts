import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  postLedgerEntry,
  LedgerOutboundError,
  __setAcquireFn,
  __setFetchImpl,
  __resetLedgerClient,
} from '../src/lib/ledgerClient.js';

const signedProofs: string[] = [];
const signedNonces: Array<string | undefined> = [];

vi.mock('@s2s/auth-library', () => ({
  signDPoP: vi.fn(async (opts: { nonce?: string }) => {
    const proof = `proof-${signedProofs.length + 1}${opts.nonce ? `-with-nonce-${opts.nonce}` : ''}`;
    signedProofs.push(proof);
    signedNonces.push(opts.nonce);
    return { proof, jti: `jti-${signedProofs.length}` };
  }),
  createAcquireToken: () => () => Promise.resolve({ accessToken: 'tok-123', expiresAt: 0, scopes: [], tokenSource: 'cognito' }),
  TokenCache: class { constructor(_: unknown) {} },
  getRedisClient: () => ({}),
  getClientSecret: vi.fn(async () => JSON.stringify({ client_secret: 'shh' })),
  buildBreaker: () => ({ execute: <T>(fn: () => Promise<T>) => fn() }),
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
    __resetLedgerClient();
  });

  it('acquires token, signs DPoP, and POSTs with correct headers', async () => {
    const acquire = vi.fn(async () => ({ accessToken: 'tok-xyz', expiresAt: 0, scopes: ['ledger/write'], tokenSource: 'cognito' as const }));
    __setAcquireFn(acquire);
    const fetchMock = vi.fn(async () => jsonResponse(201, { entryId: 'E-1', status: 'committed' }));
    __setFetchImpl(fetchMock as unknown as typeof fetch);

    const result = await postLedgerEntry(cfg, {
      correlationId: 'corr-1',
      payload: { loanId: 'L-aaa', amount: 100 },
    });

    expect(result).toEqual({ entryId: 'E-1', status: 'committed' });
    expect(acquire).toHaveBeenCalledWith('receiving-service-outbound', ['ledger/write']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://ledger.local/api/ledger/entries');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('DPoP tok-xyz');
    expect(headers.dpop).toBe('proof-1');
    expect(headers['x-correlation-id']).toBe('corr-1');
    expect(headers['content-type']).toBe('application/json');
    expect((init as RequestInit).body).toBe(JSON.stringify({ loanId: 'L-aaa', amount: 100 }));
  });

  it('retries once on 401 with DPoP-Nonce header echoed back', async () => {
    __setAcquireFn(async () => ({ accessToken: 'tok-xyz', expiresAt: 0, scopes: [], tokenSource: 'cognito' as const }));
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

    const result = await postLedgerEntry(cfg, { correlationId: 'corr-2', payload: { loanId: 'L-b' } });
    expect(result.entryId).toBe('E-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signedNonces).toEqual([undefined, 'NONCE-7']);
  });

  it('throws LedgerOutboundError on 500 after retry exhausted', async () => {
    __setAcquireFn(async () => ({ accessToken: 'tok', expiresAt: 0, scopes: [], tokenSource: 'cognito' as const }));
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    __setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(
      postLedgerEntry(cfg, { correlationId: 'corr-3', payload: {} }),
    ).rejects.toBeInstanceOf(LedgerOutboundError);
  });

  it('does not retry on non-401 4xx errors', async () => {
    __setAcquireFn(async () => ({ accessToken: 'tok', expiresAt: 0, scopes: [], tokenSource: 'cognito' as const }));
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    __setFetchImpl(fetchMock as unknown as typeof fetch);
    await expect(
      postLedgerEntry(cfg, { correlationId: 'corr-4', payload: {} }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
