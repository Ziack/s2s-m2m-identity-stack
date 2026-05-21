import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createLatticeFetch,
  LATTICE_SIGNING_SERVICE,
  DPOP_TOKEN_HEADER,
} from '../../src/lattice/sigv4Client.js';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';

interface CapturedRequest {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Lower-cases header keys so assertions are case-insensitive. */
function normalizeHeaders(raw: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (raw instanceof Headers) {
    raw.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
  } else if (Array.isArray(raw)) {
    for (const [k, v] of raw) out[k.toLowerCase()] = v;
  } else {
    for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

function makeCapturingFetch(captured: CapturedRequest[]): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      method: init?.method,
      headers: normalizeHeaders(init?.headers),
      body: init?.body === undefined ? undefined : String(init?.body),
    });
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

// Static, well-known throwaway credentials — never real.
const STATIC_CREDS: AwsCredentialIdentityProvider = async () => ({
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
});

const TEMP_CREDS: AwsCredentialIdentityProvider = async () => ({
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  sessionToken: 'FwoGZXIvYXdzEXAMPLESESSIONTOKEN',
});

const FIXED_DATE = new Date('2026-05-21T12:00:00.000Z');

describe('createLatticeFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs the request with a SigV4 Authorization header and X-Amz-Date', async () => {
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'us-east-1',
      credentials: STATIC_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    await latticeFetch({
      url: 'https://svc.vpc-lattice-svcs.us-east-1.on.aws/v1/things',
      method: 'GET',
    });

    expect(captured).toHaveLength(1);
    const h = captured[0]!.headers;
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(h.authorization).toContain('Credential=AKIDEXAMPLE/');
    expect(h.authorization).toContain(`/us-east-1/${LATTICE_SIGNING_SERVICE}/aws4_request`);
    expect(h['x-amz-date']).toBeDefined();
    expect(h['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('produces a deterministic signature for a fixed date + static creds', async () => {
    const captured1: CapturedRequest[] = [];
    const captured2: CapturedRequest[] = [];

    const f1 = createLatticeFetch({ region: 'us-east-1', credentials: STATIC_CREDS, fetchImpl: makeCapturingFetch(captured1) });
    const f2 = createLatticeFetch({ region: 'us-east-1', credentials: STATIC_CREDS, fetchImpl: makeCapturingFetch(captured2) });

    const input = {
      url: 'https://svc.vpc-lattice-svcs.us-east-1.on.aws/v1/things',
      method: 'GET',
    };
    await f1(input);
    await f2(input);

    expect(captured1[0]!.headers.authorization).toBe(captured2[0]!.headers.authorization);
    expect(captured1[0]!.headers['x-amz-date']).toBe('20260521T120000Z');
  });

  it('includes X-Amz-Security-Token when credentials are temporary', async () => {
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'us-east-1',
      credentials: TEMP_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    await latticeFetch({
      url: 'https://svc.vpc-lattice-svcs.us-east-1.on.aws/v1/things',
      method: 'GET',
    });

    expect(captured[0]!.headers['x-amz-security-token']).toBe('FwoGZXIvYXdzEXAMPLESESSIONTOKEN');
  });

  it('does not emit X-Amz-Security-Token for permanent credentials', async () => {
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'us-east-1',
      credentials: STATIC_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    await latticeFetch({
      url: 'https://svc.vpc-lattice-svcs.us-east-1.on.aws/v1/things',
      method: 'GET',
    });

    expect(captured[0]!.headers['x-amz-security-token']).toBeUndefined();
  });

  it('signs the body and surfaces x-amz-content-sha256 over the body bytes', async () => {
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'us-east-1',
      credentials: STATIC_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    const body = JSON.stringify({ hello: 'world' });
    await latticeFetch({
      url: 'https://svc.vpc-lattice-svcs.us-east-1.on.aws/v1/things',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    const h = captured[0]!.headers;
    // SHA-256 of the exact body bytes — proves the body is part of the signature.
    const { createHash } = await import('node:crypto');
    const expectedHash = createHash('sha256').update(body).digest('hex');
    expect(h['x-amz-content-sha256']).toBe(expectedHash);
    expect(captured[0]!.body).toBe(body);
    // signed-headers list must cover content-type since we sent it
    expect(h.authorization).toContain('SignedHeaders=');
    expect(h.authorization.toLowerCase()).toContain('content-type');
  });

  it('carries the DPoP access token in X-DPoP-Token (not Authorization)', async () => {
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'us-east-1',
      credentials: STATIC_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    const accessToken = 'exchanged-access-token-xyz';
    const dpopProof = 'eyJ0eXAiOiJkcG9wK2p3dCJ9.proof.sig';

    await latticeFetch({
      url: 'https://svc.vpc-lattice-svcs.us-east-1.on.aws/v1/things',
      method: 'POST',
      headers: {
        [DPOP_TOKEN_HEADER]: accessToken,
        DPoP: dpopProof,
        'content-type': 'application/json',
      },
      body: '{}',
    });

    const h = captured[0]!.headers;
    // Authorization is owned by SigV4 — NOT the DPoP token.
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(h.authorization).not.toContain(accessToken);
    // The DPoP access token rides in the dedicated header...
    expect(h[DPOP_TOKEN_HEADER.toLowerCase()]).toBe(accessToken);
    // ...and the DPoP proof header is untouched.
    expect(h.dpop).toBe(dpopProof);
  });

  it('defaults the signing service to vpc-lattice-svcs', async () => {
    expect(LATTICE_SIGNING_SERVICE).toBe('vpc-lattice-svcs');
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'eu-west-1',
      credentials: STATIC_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    await latticeFetch({
      url: 'https://svc.vpc-lattice-svcs.eu-west-1.on.aws/v1/things',
      method: 'GET',
    });

    expect(captured[0]!.headers.authorization).toContain('/eu-west-1/vpc-lattice-svcs/aws4_request');
  });

  it('honours an overridden service name', async () => {
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'us-east-1',
      service: 'custom-svc',
      credentials: STATIC_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    await latticeFetch({
      url: 'https://svc.example.aws/v1/things',
      method: 'GET',
    });

    expect(captured[0]!.headers.authorization).toContain('/us-east-1/custom-svc/aws4_request');
  });

  it('preserves the path and query string in the sent URL', async () => {
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'us-east-1',
      credentials: STATIC_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    await latticeFetch({
      url: 'https://svc.vpc-lattice-svcs.us-east-1.on.aws/v1/things?limit=10&cursor=abc',
      method: 'GET',
    });

    const sent = new URL(captured[0]!.url);
    expect(sent.pathname).toBe('/v1/things');
    expect(sent.searchParams.get('limit')).toBe('10');
    expect(sent.searchParams.get('cursor')).toBe('abc');
  });

  it('sends the host header matching the URL authority', async () => {
    const captured: CapturedRequest[] = [];
    const latticeFetch = createLatticeFetch({
      region: 'us-east-1',
      credentials: STATIC_CREDS,
      fetchImpl: makeCapturingFetch(captured),
    });

    await latticeFetch({
      url: 'https://svc.vpc-lattice-svcs.us-east-1.on.aws/v1/things',
      method: 'GET',
    });

    expect(captured[0]!.headers.host).toBe('svc.vpc-lattice-svcs.us-east-1.on.aws');
  });
});
