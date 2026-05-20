import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { jwksRouter } from '../src/routes/jwks.js';
import { createSigningKeyLoader } from '../src/lib/signingKeyLoader.js';
import { makeRsaKey } from './helpers/testFixtures.js';

describe('JWKS route', () => {
  it('publishes the loader public key as a single-key JWKS', async () => {
    const km = await makeRsaKey();
    const loader = createSigningKeyLoader({
      secretArn: 'arn:test',
      fetchSecret: async () => km.privatePem,
    });
    const app = express();
    app.use(jwksRouter(loader));
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(res.body.keys).toHaveLength(1);
    const key = res.body.keys[0];
    expect(key.kid).toBe(km.kid);
    expect(key.kty).toBe('RSA');
    expect(key.use).toBe('sig');
    expect(key.alg).toBe('RS256');
    expect(key.n).toBeTruthy();
    expect(key.e).toBeTruthy();
    // Must not include private parameters
    expect(key.d).toBeUndefined();
    expect(key.p).toBeUndefined();
  });

  it('returns 503 when signing key fails to load', async () => {
    const loader = createSigningKeyLoader({
      secretArn: 'arn:test',
      fetchSecret: async () => { throw new Error('boom'); },
    });
    const app = express();
    app.use(jwksRouter(loader));
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(503);
  });
});
