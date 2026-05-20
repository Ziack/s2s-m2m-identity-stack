import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { discoveryRouter } from '../src/routes/discovery.js';
import type { TokenBrokerConfig } from '../src/config.js';

const baseConfig: TokenBrokerConfig = {
  port: 0,
  awsRegion: 'us-east-1',
  logLevel: 'silent',
  brokerIssuerUrl: 'https://broker.test/auth',
  brokerSigningKeySecretArn: 'arn:test',
  userIssuerUrl: 'https://calling-service/auth',
  userIssuerAudience: 'calling-service',
  userIssuerJwksUri: 'https://calling-service/auth/.well-known/jwks.json',
  actorCatalogPath: '/tmp/none',
  redisEndpoint: 'redis://localhost:6379',
  dpopRequired: true,
  exchangedTokenTtlSeconds: 600,
  replayTtlSeconds: 600,
  jwksRefreshHours: 1,
  signingKeyTtlMs: 3_600_000,
};

describe('discovery route', () => {
  it('returns OIDC metadata with correct issuer + jwks_uri + token_endpoint', async () => {
    const app = express();
    app.use(discoveryRouter(baseConfig));
    const res = await request(app).get('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBe('https://broker.test/auth');
    expect(res.body.jwks_uri).toBe('https://broker.test/auth/.well-known/jwks.json');
    expect(res.body.token_endpoint).toBe('https://broker.test/auth/oauth2/token');
    expect(res.body.grant_types_supported).toContain('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(res.body.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
    expect(res.body.subject_token_types_supported).toEqual(
      expect.arrayContaining([
        'urn:ietf:params:oauth:token-type:access_token',
        'urn:ietf:params:oauth:token-type:jwt',
      ]),
    );
  });
});
