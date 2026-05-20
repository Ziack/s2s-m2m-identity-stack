import { describe, it, expect } from 'vitest';
import { createExchangeToken } from '../../src/auth/exchangeToken.js';
import { AuthError } from '../../src/errors.js';

interface CapturedRequest {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: URLSearchParams;
}

function makeFetchOk(body: Record<string, unknown>, captured: CapturedRequest[]): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    if (rawHeaders) for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = v;
    captured.push({
      url: String(url),
      method: init?.method,
      headers,
      body: new URLSearchParams(String(init?.body ?? '')),
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function makeFetchStatus(status: number, body: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('exchangeToken', () => {
  it('POSTs RFC 8693 form-encoded body with all required fields and Basic auth', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = makeFetchOk(
      {
        access_token: 'exchanged-token-xyz',
        token_type: 'DPoP',
        expires_in: 600,
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: 'read write',
      },
      captured,
    );

    const exchange = createExchangeToken({
      brokerUrl: 'https://broker/oauth2/token',
      actorClientId: 'calling-service',
      actorClientSecret: 's3cret',
      audience: 'downstream-service',
      scope: ['read', 'write'],
      fetchImpl,
    });

    const r = await exchange({ subjectToken: 'user-jwt' });

    expect(r.accessToken).toBe('exchanged-token-xyz');
    expect(r.tokenType).toBe('DPoP');
    expect(r.issuedTokenType).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(r.scopes).toEqual(['read', 'write']);
    expect(r.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe('https://broker/oauth2/token');
    expect(req.method).toBe('POST');
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');

    const expectedBasic = 'Basic ' + Buffer.from('calling-service:s3cret').toString('base64');
    expect(req.headers['authorization']).toBe(expectedBasic);

    expect(req.body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(req.body.get('subject_token')).toBe('user-jwt');
    expect(req.body.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(req.body.get('audience')).toBe('downstream-service');
    expect(req.body.get('scope')).toBe('read write');
    expect(req.body.get('requested_token_use')).toBe('on_behalf_of');
  });

  it('resolves async client secret loader', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = makeFetchOk({ access_token: 't', token_type: 'Bearer', expires_in: 60 }, captured);
    const exchange = createExchangeToken({
      brokerUrl: 'https://broker/token',
      actorClientId: 'svc',
      actorClientSecret: async () => 'async-secret',
      audience: 'aud',
      scope: [],
      fetchImpl,
    });
    await exchange({ subjectToken: 'sub' });
    const expected = 'Basic ' + Buffer.from('svc:async-secret').toString('base64');
    expect(captured[0]!.headers['authorization']).toBe(expected);
  });

  it('allows per-call override of audience and scope', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = makeFetchOk({ access_token: 't', token_type: 'Bearer', expires_in: 60 }, captured);
    const exchange = createExchangeToken({
      brokerUrl: 'https://broker/token',
      actorClientId: 'svc',
      actorClientSecret: 'x',
      audience: 'default-aud',
      scope: ['default'],
      fetchImpl,
    });
    await exchange({ subjectToken: 'sub', audience: 'override-aud', scope: ['s1', 's2'] });
    expect(captured[0]!.body.get('audience')).toBe('override-aud');
    expect(captured[0]!.body.get('scope')).toBe('s1 s2');
  });

  it('defaults tokenType to Bearer when broker does not return token_type=DPoP', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = makeFetchOk({ access_token: 't', expires_in: 60 }, captured);
    const exchange = createExchangeToken({
      brokerUrl: 'https://broker/token',
      actorClientId: 'svc',
      actorClientSecret: 'x',
      audience: 'a',
      scope: [],
      fetchImpl,
    });
    const r = await exchange({ subjectToken: 'sub' });
    expect(r.tokenType).toBe('Bearer');
  });

  it('throws AuthError(invalid_token) on broker 401', async () => {
    const fetchImpl = makeFetchStatus(401, { error: 'invalid_grant', error_description: 'bad subject' });
    const exchange = createExchangeToken({
      brokerUrl: 'https://broker/token',
      actorClientId: 'svc',
      actorClientSecret: 'x',
      audience: 'a',
      scope: [],
      fetchImpl,
    });
    await expect(exchange({ subjectToken: 'sub' })).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('attaches details.upstream on 5xx for retry-classification', async () => {
    const fetchImpl = makeFetchStatus(503, { error: 'temporarily_unavailable' });
    const exchange = createExchangeToken({
      brokerUrl: 'https://broker/token',
      actorClientId: 'svc',
      actorClientSecret: 'x',
      audience: 'a',
      scope: [],
      fetchImpl,
    });
    try {
      await exchange({ subjectToken: 'sub' });
      throw new Error('expected exchange to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      const err = e as AuthError;
      expect(err.code).toBe('invalid_token');
      expect(err.details).toEqual({ upstream: 503 });
    }
  });

  it('propagates network errors as AuthError(invalid_token)', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const exchange = createExchangeToken({
      brokerUrl: 'https://broker/token',
      actorClientId: 'svc',
      actorClientSecret: 'x',
      audience: 'a',
      scope: [],
      fetchImpl,
    });
    await expect(exchange({ subjectToken: 'sub' })).rejects.toBeInstanceOf(AuthError);
  });
});
