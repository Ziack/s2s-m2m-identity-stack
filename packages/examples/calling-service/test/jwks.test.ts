import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { jwksRouter } from '../src/routes/jwks.js';

vi.mock('@s2s/auth-library', () => ({
  getPublicJwk: () => ({ kty: 'EC', crv: 'P-256', x: 'XXX', y: 'YYY', kid: 'k1', use: 'sig', alg: 'ES256' }),
}));

describe('GET /.well-known/jwks.json', () => {
  it('returns a JWKS document with the current public key', async () => {
    const app = express().use(jwksRouter());
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
  });

  it('sets a sensible Cache-Control header', async () => {
    const app = express().use(jwksRouter());
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  });
});
