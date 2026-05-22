import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthMiddleware } from '../src/middleware.js';
import { AuthError, ERROR_CODES } from '../src/errors.js';
import type { Request, Response } from 'express';

describe('createAuthMiddleware', () => {
  let next: (err?: unknown) => void;
  let nextErr: unknown;
  let res: Partial<Response>;
  let statusCode: number | null;
  let body: unknown;
  let headers: Record<string, string>;

  beforeEach(() => {
    nextErr = undefined;
    next = (err?: unknown) => { nextErr = err; };
    statusCode = null;
    body = null;
    headers = {};
    res = {
      status: ((code: number) => { statusCode = code; return res as Response; }) as Response['status'],
      json: ((b: unknown) => { body = b; return res as Response; }) as Response['json'],
      setHeader: ((k: string, v: string) => { headers[k] = v; return res as Response; }) as Response['setHeader'],
    };
  });

  it('rejects missing Authorization header with 401 invalid_token', async () => {
    const mw = createAuthMiddleware({
      expectedAudience: 'aud',
      resourcePrefix: 'Resource',
      validateToken: async () => { throw new Error('not called'); },
      verifyDPoP: async () => { throw new Error('not called'); },
      authorize: async () => ({ decision: 'ALLOW', reasons: [], evaluationTimeMs: 1, mode: 'api' }),
    });
    const req = { method: 'GET', originalUrl: '/x', protocol: 'https', get: () => 'api.example', headers: {} } as unknown as Request;
    await mw(req, res as Response, next);
    expect(statusCode).toBe(401);
    expect((body as { error: string }).error).toBe('invalid_token');
    expect(headers['WWW-Authenticate']).toMatch(/Bearer|DPoP/);
  });

  it('chains validateToken → verifyDPoP → authorize and attaches req.auth on success', async () => {
    const mw = createAuthMiddleware({
      expectedAudience: 'aud',
      resourcePrefix: 'Resource::svc',
      validateToken: async () => ({ sub: 'client-x', scope: ['a'], iss: 'iss', aud: 'aud', exp: 999, raw: {} }),
      verifyDPoP: async () => ({ ok: true, jti: 'j', jwkThumbprint: 't', iat: 0 }),
      authorize: async () => ({ decision: 'ALLOW', reasons: ['p-1'], evaluationTimeMs: 1, mode: 'api' }),
    });
    const req = { method: 'GET', originalUrl: '/x', protocol: 'https', get: (h: string) => h === 'host' ? 'api.example' : undefined, headers: { authorization: 'DPoP abc', dpop: 'proof' } } as unknown as Request & { auth?: unknown };
    await mw(req, res as Response, next);
    expect(nextErr).toBeUndefined();
    expect(req.auth).toMatchObject({ sub: 'client-x', scopes: ['a'], decision: 'ALLOW' });
  });

  it('returns 403 when authorize denies', async () => {
    const mw = createAuthMiddleware({
      expectedAudience: 'aud',
      resourcePrefix: 'Resource::svc',
      validateToken: async () => ({ sub: 'c', scope: ['a'], iss: 'iss', aud: 'aud', exp: 999, raw: {} }),
      verifyDPoP: async () => ({ ok: true, jti: 'j', jwkThumbprint: 't', iat: 0 }),
      authorize: async () => ({ decision: 'DENY', reasons: ['p-deny'], evaluationTimeMs: 1, mode: 'api' }),
    });
    const req = { method: 'GET', originalUrl: '/x', protocol: 'https', get: () => 'api.example', headers: { authorization: 'DPoP abc', dpop: 'proof' } } as unknown as Request;
    await mw(req, res as Response, next);
    expect(statusCode).toBe(403);
    expect((body as { error: string }).error).toBe('authorization_denied');
  });

  it('sets DPoP-Nonce response header when verifyDPoP throws an AuthError carrying challengeNonce', async () => {
    const mw = createAuthMiddleware({
      expectedAudience: 'aud',
      resourcePrefix: 'Resource::svc',
      validateToken: async () => ({ sub: 'c', scope: ['a'], iss: 'iss', aud: 'aud', exp: 999, raw: {} }),
      verifyDPoP: async () => {
        throw new AuthError(401, ERROR_CODES.USE_DPOP_NONCE, 'server requires DPoP-Nonce echo', {
          challengeNonce: 'nonce-abc-123',
        });
      },
      authorize: async () => ({ decision: 'ALLOW', reasons: [], evaluationTimeMs: 1, mode: 'api' }),
    });
    const req = { method: 'POST', originalUrl: '/x', protocol: 'https', get: () => 'api.example', headers: { authorization: 'DPoP abc', dpop: 'proof' } } as unknown as Request;
    await mw(req, res as Response, next);
    expect(statusCode).toBe(401);
    expect((body as { error: string }).error).toBe('use_dpop_nonce');
    expect(headers['DPoP-Nonce']).toBe('nonce-abc-123');
    expect(headers['WWW-Authenticate']).toMatch(/DPoP/);
  });

  it('does not set DPoP-Nonce header for AuthErrors without a challengeNonce', async () => {
    const mw = createAuthMiddleware({
      expectedAudience: 'aud',
      resourcePrefix: 'Resource::svc',
      validateToken: async () => {
        throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'bad token');
      },
      verifyDPoP: async () => ({ ok: true, jti: 'j', jwkThumbprint: 't', iat: 0 }),
      authorize: async () => ({ decision: 'ALLOW', reasons: [], evaluationTimeMs: 1, mode: 'api' }),
    });
    const req = { method: 'GET', originalUrl: '/x', protocol: 'https', get: () => 'api.example', headers: { authorization: 'DPoP abc', dpop: 'proof' } } as unknown as Request;
    await mw(req, res as Response, next);
    expect(statusCode).toBe(401);
    expect(headers['DPoP-Nonce']).toBeUndefined();
  });
});
