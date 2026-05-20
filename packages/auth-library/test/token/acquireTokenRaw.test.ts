import { describe, it, expect } from 'vitest';
import { acquireTokenRaw, CognitoTokenError } from '../../src/token/acquireTokenRaw.js';

describe('acquireTokenRaw', () => {
  it('POSTs grant_type=client_credentials with Basic auth and returns body on 200', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 300, scope: 'a b' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const r = await acquireTokenRaw({
      cognitoDomain: 'https://x.auth.us-east-1.amazoncognito.com',
      clientId: 'client-1',
      clientSecret: 'shh',
      scopes: ['a', 'b'],
      fetchImpl,
    });
    expect(r.access_token).toBe('tok-1');
    expect(r.expires_in).toBe(300);
    expect(capturedUrl).toBe('https://x.auth.us-east-1.amazoncognito.com/oauth2/token');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Basic ${Buffer.from('client-1:shh').toString('base64')}`);
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(capturedInit?.body).toBe('grant_type=client_credentials&scope=a+b');
  });

  it('throws CognitoTokenError on non-200 with status and body', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    await expect(
      acquireTokenRaw({
        cognitoDomain: 'https://x',
        clientId: 'c',
        clientSecret: 's',
        scopes: ['a'],
        fetchImpl,
      }),
    ).rejects.toMatchObject({ name: 'CognitoTokenError', status: 429 });
  });

  it('strips trailing slash from cognitoDomain', async () => {
    let capturedUrl = '';
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ access_token: 't', expires_in: 1, scope: 'a' }), { status: 200 });
    }) as unknown as typeof fetch;
    await acquireTokenRaw({
      cognitoDomain: 'https://x.auth.us-east-1.amazoncognito.com/',
      clientId: 'c',
      clientSecret: 's',
      scopes: ['a'],
      fetchImpl,
    });
    expect(capturedUrl).toBe('https://x.auth.us-east-1.amazoncognito.com/oauth2/token');
  });

  it('CognitoTokenError is instanceof Error', () => {
    const e = new CognitoTokenError(503, 'boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(503);
    expect(e.body).toBe('boom');
  });
});
