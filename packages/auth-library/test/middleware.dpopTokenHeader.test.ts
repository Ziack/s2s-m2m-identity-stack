import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthMiddleware } from '../src/middleware.js';
import { DPOP_TOKEN_HEADER } from '../src/lattice/sigv4Client.js';
import type { Request, Response } from 'express';

/**
 * Phase 4 Job A: the auth middleware must read the DPoP-bound access token from
 * the `X-DPoP-Token` header first (Lattice contract — `Authorization` is taken
 * by the SigV4 credential), falling back to `Authorization: DPoP <token>` for
 * direct/non-Lattice callers.
 */
describe('createAuthMiddleware — X-DPoP-Token source resolution', () => {
  const HDR = DPOP_TOKEN_HEADER.toLowerCase();
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

  function makeMw(opts: {
    onValidate: (token: string) => void;
  } = { onValidate: () => {} }) {
    return createAuthMiddleware({
      expectedAudience: 'aud',
      resourcePrefix: 'Resource::svc',
      validateToken: async (token: string) => {
        opts.onValidate(token);
        return { sub: 'client-x', scope: ['a'], iss: 'iss', aud: 'aud', exp: 999, raw: {} };
      },
      verifyDPoP: async () => ({ ok: true, jti: 'j', jwkThumbprint: 't', iat: 0 }),
      authorize: async () => ({ decision: 'ALLOW', reasons: ['p-1'], evaluationTimeMs: 1, mode: 'api' }),
    });
  }

  it('reads the access token from X-DPoP-Token and verifies', async () => {
    let seen = '';
    const mw = makeMw({ onValidate: (t) => { seen = t; } });
    const req = {
      method: 'GET', originalUrl: '/x', protocol: 'https',
      get: (h: string) => (h === 'host' ? 'svc.lattice' : undefined),
      headers: { [HDR]: 'lattice-access-token', dpop: 'proof' },
    } as unknown as Request & { auth?: unknown };
    await mw(req, res as Response, next);
    expect(nextErr).toBeUndefined();
    expect(seen).toBe('lattice-access-token');
    expect(req.auth).toMatchObject({ sub: 'client-x', decision: 'ALLOW' });
  });

  it('falls back to Authorization: DPoP when X-DPoP-Token absent (back-compat)', async () => {
    let seen = '';
    const mw = makeMw({ onValidate: (t) => { seen = t; } });
    const req = {
      method: 'GET', originalUrl: '/x', protocol: 'https',
      get: (h: string) => (h === 'host' ? 'api.example' : undefined),
      headers: { authorization: 'DPoP direct-token', dpop: 'proof' },
    } as unknown as Request & { auth?: unknown };
    await mw(req, res as Response, next);
    expect(nextErr).toBeUndefined();
    expect(seen).toBe('direct-token');
    expect(req.auth).toMatchObject({ sub: 'client-x', decision: 'ALLOW' });
  });

  it('X-DPoP-Token wins when both X-DPoP-Token and Authorization present', async () => {
    let seen = '';
    const mw = makeMw({ onValidate: (t) => { seen = t; } });
    const req = {
      method: 'GET', originalUrl: '/x', protocol: 'https',
      get: (h: string) => (h === 'host' ? 'svc.lattice' : undefined),
      // Authorization here holds the SigV4 credential (simulated); must be ignored.
      headers: { [HDR]: 'lattice-token', authorization: 'AWS4-HMAC-SHA256 Credential=...', dpop: 'proof' },
    } as unknown as Request & { auth?: unknown };
    await mw(req, res as Response, next);
    expect(nextErr).toBeUndefined();
    expect(seen).toBe('lattice-token');
  });

  it('tolerates an accidental DPoP prefix inside X-DPoP-Token', async () => {
    let seen = '';
    const mw = makeMw({ onValidate: (t) => { seen = t; } });
    const req = {
      method: 'GET', originalUrl: '/x', protocol: 'https',
      get: (h: string) => (h === 'host' ? 'svc.lattice' : undefined),
      headers: { [HDR]: 'DPoP prefixed-token', dpop: 'proof' },
    } as unknown as Request & { auth?: unknown };
    await mw(req, res as Response, next);
    expect(nextErr).toBeUndefined();
    expect(seen).toBe('prefixed-token');
  });

  it('rejects 401 when neither X-DPoP-Token nor Authorization present', async () => {
    const mw = makeMw();
    const req = {
      method: 'GET', originalUrl: '/x', protocol: 'https',
      get: () => 'api.example', headers: {},
    } as unknown as Request;
    await mw(req, res as Response, next);
    expect(statusCode).toBe(401);
    expect((body as { error: string }).error).toBe('invalid_token');
  });
});
