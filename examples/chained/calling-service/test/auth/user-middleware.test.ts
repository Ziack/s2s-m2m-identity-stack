import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { generateKeyPair, exportPKCS8, exportJWK, calculateJwkThumbprint, type JWK } from 'jose';
import {
  createValidateUserToken,
  createJwksManager,
  signUserJwt,
} from '@s2s/auth-library';
import { createUserAuthMiddleware } from '../../src/lib/userAuthMiddleware.js';

const ISSUER = 'http://test/auth';
const AUDIENCE = 'calling-service';

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: JWK & { kid: string };
let kid: string;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  privateKey = kp.privateKey;
  await exportPKCS8(kp.privateKey);
  const jwk = await exportJWK(kp.publicKey);
  const base: JWK = { kty: jwk.kty, n: jwk.n, e: jwk.e };
  kid = await calculateJwkThumbprint(base, 'sha256');
  publicJwk = { ...base, kid, use: 'sig', alg: 'RS256' } as JWK & { kid: string };
});

function buildJwksFetch(): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ keys: [publicJwk] }),
  } as unknown as Response)) as unknown as typeof fetch;
}

function buildApp(opts?: { skip?: string[] }) {
  const jwksManager = createJwksManager({
    jwksUri: 'http://test/.well-known/jwks.json',
    refreshHours: 1,
    fetchImpl: buildJwksFetch(),
  });
  const validate = createValidateUserToken({
    jwksManager,
    expectedIssuer: ISSUER,
    expectedAudience: AUDIENCE,
  });
  const mwOpts: { validate: typeof validate; skipPaths?: string[] } = { validate };
  if (opts?.skip) mwOpts.skipPaths = opts.skip;
  const mw = createUserAuthMiddleware(mwOpts);
  const app = express();
  app.use(express.json());
  app.use(mw);
  app.get('/protected', (req: Request, res: Response) => {
    res.json({ user: req.user });
  });
  app.get('/auth/login', (_req: Request, res: Response) => res.json({ ok: true }));
  app.get('/.well-known/jwks.json', (_req: Request, res: Response) => res.json({ ok: true }));
  return app;
}

async function mint(opts: { sub: string; ttl?: number; iss?: string; aud?: string }) {
  return signUserJwt(
    {
      issuer: opts.iss ?? ISSUER,
      audience: opts.aud ?? AUDIENCE,
      privateKey,
      kid,
      ttlSeconds: opts.ttl ?? 600,
    },
    { sub: opts.sub, roles: ['reader'], groups: ['g1'] },
  );
}

describe('userAuthMiddleware', () => {
  it('attaches req.user on valid bearer token', async () => {
    const token = await mint({ sub: 'user-x' });
    const res = await request(buildApp()).get('/protected').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.sub).toBe('user-x');
    expect(res.body.user.roles).toEqual(['reader']);
  });

  it('returns 401 invalid_token when Authorization header is missing', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    expect(res.headers['www-authenticate']).toMatch(/Bearer/);
  });

  it('returns 401 token_expired for an expired token', async () => {
    const token = await signUserJwt(
      { issuer: ISSUER, audience: AUDIENCE, privateKey, kid, ttlSeconds: 600 },
      { sub: 'u', nowFn: () => Date.now() - 3_600_000 },
    );
    const res = await request(buildApp()).get('/protected').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('token_expired');
  });

  it('bypasses /auth/* and /.well-known/* routes', async () => {
    const a = await request(buildApp()).get('/auth/login');
    expect(a.status).toBe(200);
    const j = await request(buildApp()).get('/.well-known/jwks.json');
    expect(j.status).toBe(200);
  });
});
