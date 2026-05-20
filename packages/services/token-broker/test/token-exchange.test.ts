import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { decodeJwt, jwtVerify, importJWK } from 'jose';
import { tokenRouter } from '../src/routes/token.js';
import { jwksRouter } from '../src/routes/jwks.js';
import { createSigningKeyLoader } from '../src/lib/signingKeyLoader.js';
import { loadActorCatalog, hashClientSecret } from '../src/lib/actorCatalog.js';
import { createSubjectTokenValidator } from '../src/lib/subjectTokenValidator.js';
import { createReplayStore } from '../src/lib/replayStore.js';
import { buildBrokerMetrics, resetBrokerMetricsForTest } from '../src/routes/metrics.js';
import type { TokenBrokerConfig } from '../src/config.js';
import {
  makeRsaKey,
  signTestUserJwt,
  buildJwksFetcher,
  makeInMemoryRedis,
  type TestKeyMaterial,
} from './helpers/testFixtures.js';

const BROKER_ISSUER = 'https://broker.test/auth';
const USER_ISSUER = 'https://calling-service/auth';
const USER_AUDIENCE = 'calling-service';

function basicAuth(id: string, secret: string): string {
  return 'Basic ' + Buffer.from(`${id}:${secret}`, 'utf8').toString('base64');
}

interface AppContext {
  app: express.Express;
  brokerKey: TestKeyMaterial;
  userKey: TestKeyMaterial;
}

async function buildApp(opts?: { brokerKey?: TestKeyMaterial; userKey?: TestKeyMaterial }): Promise<AppContext> {
  resetBrokerMetricsForTest();
  const brokerKey = opts?.brokerKey ?? (await makeRsaKey());
  const userKey = opts?.userKey ?? (await makeRsaKey());

  const config: TokenBrokerConfig = {
    port: 0,
    awsRegion: 'us-east-1',
    logLevel: 'silent',
    brokerIssuerUrl: BROKER_ISSUER,
    brokerSigningKeySecretArn: 'arn:test',
    userIssuerUrl: USER_ISSUER,
    userIssuerAudience: USER_AUDIENCE,
    userIssuerJwksUri: `${USER_ISSUER}/.well-known/jwks.json`,
    actorCatalogPath: '/tmp/none',
    redisEndpoint: 'redis://localhost:6379',
    dpopRequired: true,
    exchangedTokenTtlSeconds: 600,
    replayTtlSeconds: 600,
    jwksRefreshHours: 1,
    signingKeyTtlMs: 3_600_000,
  };

  const signingKey = createSigningKeyLoader({
    secretArn: 'arn:test',
    fetchSecret: async () => brokerKey.privatePem,
  });

  const catalog = loadActorCatalog({
    'calling-service': {
      client_secret_hash: hashClientSecret('calling-secret'),
      allowed_audiences: ['receiving'],
      allowed_scopes: ['lending/read', 'lending/write'],
    },
    'receiving-service-outbound': {
      client_secret_hash: hashClientSecret('recv-secret'),
      allowed_audiences: ['ledger'],
      allowed_scopes: ['ledger/read', 'ledger/write'],
    },
  });

  // Compose a fetcher that serves user JWKS or broker JWKS based on URL.
  const fetchImpl: typeof fetch = (async (input: unknown, _init?: unknown) => {
    const url = typeof input === 'string' ? input : (input as { url?: string; toString: () => string }).toString();
    if (url.includes('calling-service')) {
      return buildJwksFetcher([userKey.publicJwk])(url as unknown as RequestInfo);
    }
    return buildJwksFetcher([brokerKey.publicJwk])(url as unknown as RequestInfo);
  }) as unknown as typeof fetch;

  const subjectValidator = createSubjectTokenValidator({
    brokerIssuerUrl: BROKER_ISSUER,
    brokerJwksUri: `${BROKER_ISSUER}/.well-known/jwks.json`,
    userIssuerUrl: USER_ISSUER,
    userIssuerJwksUri: `${USER_ISSUER}/.well-known/jwks.json`,
    userIssuerAudience: USER_AUDIENCE,
    jwksRefreshHours: 1,
    fetchImpl,
  });

  const redis = makeInMemoryRedis();
  const replayStore = createReplayStore({ redis, ttlSeconds: 600 });
  const metrics = buildBrokerMetrics();

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(jwksRouter(signingKey));
  app.use(tokenRouter({ config, catalog, signingKey, subjectValidator, replayStore, metrics }));
  return { app, brokerKey, userKey };
}

describe('POST /oauth2/token (RFC 8693 exchange)', () => {
  let ctx: AppContext;
  let userJwt: string;

  beforeAll(async () => {
    ctx = await buildApp();
    userJwt = await signTestUserJwt({
      privateKey: ctx.userKey.privateKey,
      kid: ctx.userKey.kid,
      issuer: USER_ISSUER,
      audience: USER_AUDIENCE,
      sub: 'user-alice',
      roles: ['admin'],
      groups: ['eng'],
    });
  });

  it('happy path: mints an exchanged JWT with correct claims', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: userJwt,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'receiving',
        scope: 'lending/write',
      });

    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('DPoP');
    expect(res.body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:jwt');
    expect(res.body.expires_in).toBe(600);
    expect(res.body.scope).toBe('lending/write');

    const decoded = decodeJwt(res.body.access_token);
    expect(decoded.iss).toBe(BROKER_ISSUER);
    expect(decoded.sub).toBe('user-alice');
    expect(decoded.aud).toBe('receiving');
    expect(decoded.scope).toBe('lending/write');
    expect(decoded.act).toEqual({ sub: 'calling-service' });
    expect(decoded.roles).toEqual(['admin']);
    expect(decoded.groups).toEqual(['eng']);

    // The issued JWT is signed by the broker key.
    const pubKey = await importJWK(ctx.brokerKey.publicJwk, 'RS256');
    const { payload } = await jwtVerify(res.body.access_token, pubKey);
    expect(payload.sub).toBe('user-alice');
  });

  it('rejects missing grant_type', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('rejects wrong grant_type with unsupported_grant_type', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({ grant_type: 'client_credentials' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('rejects missing subject_token with invalid_request', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'receiving',
        scope: 'lending/write',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('rejects unsupported subject_token_type', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: userJwt,
        subject_token_type: 'urn:weird:type',
        audience: 'receiving',
        scope: 'lending/write',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('rejects unknown actor with invalid_client', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('ghost-service', 'whatever'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: userJwt,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'receiving',
        scope: 'lending/write',
      });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('rejects bad actor secret with invalid_client', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'wrong-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: userJwt,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'receiving',
        scope: 'lending/write',
      });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('rejects missing Authorization header with invalid_client', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: userJwt,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'receiving',
        scope: 'lending/write',
      });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toMatch(/Basic/);
  });

  it('rejects audience not in actor allowed_audiences with invalid_target', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: userJwt,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'ledger', // not allowed for calling-service
        scope: 'lending/write',
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid_target');
  });

  it('rejects scopes not in actor allowed_scopes with invalid_scope', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: userJwt,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'receiving',
        scope: 'lending/write admin/superuser',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
  });

  it('rejects subject_token signed by unknown issuer with invalid_token', async () => {
    const strangerKey = await makeRsaKey();
    const stranger = await signTestUserJwt({
      privateKey: strangerKey.privateKey,
      kid: strangerKey.kid,
      issuer: 'https://someone-else',
      audience: USER_AUDIENCE,
      sub: 'mallory',
    });
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: stranger,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'receiving',
        scope: 'lending/write',
      });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('handles re-entry: validates a broker-issued subject token, composes act chain', async () => {
    // Phase 1: calling-service obtains a broker token for "receiving" aud
    const phase1 = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: userJwt,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'receiving',
        scope: 'lending/write',
      });
    expect(phase1.status).toBe(200);
    const innerToken = phase1.body.access_token as string;

    // Phase 2: receiving-service-outbound presents that broker token to exchange for ledger
    const phase2 = await request(ctx.app)
      .post('/oauth2/token')
      .set('authorization', basicAuth('receiving-service-outbound', 'recv-secret'))
      .type('form')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: innerToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'ledger',
        scope: 'ledger/write',
      });
    expect(phase2.status).toBe(200);
    const decoded = decodeJwt(phase2.body.access_token);
    expect(decoded.sub).toBe('user-alice');
    expect(decoded.aud).toBe('ledger');
    expect(decoded.act).toEqual({
      sub: 'receiving-service-outbound',
      act: { sub: 'calling-service' },
    });
  });
});
