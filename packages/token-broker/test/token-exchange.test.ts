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
import { createExchangeProofVerifier } from '../src/lib/exchangeProofVerifier.js';
import { buildBrokerMetrics, resetBrokerMetricsForTest } from '../src/routes/metrics.js';
import type { TokenBrokerConfig } from '../src/config.js';
import {
  makeRsaKey,
  makeDpopKey,
  signDpopProof,
  signTestUserJwt,
  buildJwksFetcher,
  makeInMemoryRedis,
  type TestKeyMaterial,
  type DPoPKeyMaterial,
} from './helpers/testFixtures.js';

const BROKER_ISSUER = 'https://broker.test/auth';
const USER_ISSUER = 'https://calling-service/auth';
const USER_AUDIENCE = 'calling-service';

// Fixed Host used on every request so the broker reconstructs a stable
// expected htu (matches what the test proofs sign).
const BROKER_HOST = 'broker.test';
const BROKER_HTU = `http://${BROKER_HOST}/oauth2/token`;

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
  const proofVerifier = createExchangeProofVerifier({
    redis: redis as unknown as Parameters<typeof createExchangeProofVerifier>[0]['redis'],
  });
  const metrics = buildBrokerMetrics();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.urlencoded({ extended: false }));
  app.use(jwksRouter(signingKey));
  app.use(tokenRouter({ config, catalog, signingKey, subjectValidator, replayStore, proofVerifier, metrics }));
  return { app, brokerKey, userKey };
}

describe('POST /oauth2/token (RFC 8693 exchange)', () => {
  let ctx: AppContext;
  let userJwt: string;
  let dpopKey: DPoPKeyMaterial;

  /** A fresh, valid exchange proof (unique jti each call to avoid replay). */
  async function freshProof(key?: DPoPKeyMaterial): Promise<string> {
    return signDpopProof({ key: key ?? dpopKey, htu: BROKER_HTU });
  }

  beforeAll(async () => {
    ctx = await buildApp();
    dpopKey = await makeDpopKey();
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

  it('happy path: mints an exchanged JWT with correct claims and cnf.jkt', async () => {
    const res = await request(ctx.app)
      .post('/oauth2/token')
      .set('Host', BROKER_HOST)
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .set('DPoP', await freshProof())
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
    // cnf.jkt equals the exchange proof key's thumbprint (Phase-1 shape).
    expect(decoded.cnf).toEqual({ jkt: dpopKey.thumbprint });

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
      .set('Host', BROKER_HOST)
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .set('DPoP', await freshProof())
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
      .set('Host', BROKER_HOST)
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .set('DPoP', await freshProof())
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
      .set('Host', BROKER_HOST)
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .set('DPoP', await freshProof())
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

  it('2-hop re-binding: cnf re-binds to each hop proof key; act still nests', async () => {
    // Hop 1: calling-service exchanges the user token, signing with proof K1.
    const k1 = await makeDpopKey();
    const phase1 = await request(ctx.app)
      .post('/oauth2/token')
      .set('Host', BROKER_HOST)
      .set('authorization', basicAuth('calling-service', 'calling-secret'))
      .set('DPoP', await signDpopProof({ key: k1, htu: BROKER_HTU }))
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
    // Hop-1 token is bound to K1.
    expect(decodeJwt(innerToken).cnf).toEqual({ jkt: k1.thumbprint });

    // Hop 2: receiving-service-outbound re-exchanges the inbound (cnf=K1) token,
    // signing the NEW exchange request with its own proof K2. The new token must
    // re-bind cnf to K2 (not K1), and act nests calling under receiving.
    const k2 = await makeDpopKey();
    const phase2 = await request(ctx.app)
      .post('/oauth2/token')
      .set('Host', BROKER_HOST)
      .set('authorization', basicAuth('receiving-service-outbound', 'recv-secret'))
      .set('DPoP', await signDpopProof({ key: k2, htu: BROKER_HTU }))
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
    // cnf re-bound to THIS hop's key K2, not the inbound token's K1.
    expect(decoded.cnf).toEqual({ jkt: k2.thumbprint });
    expect(k2.thumbprint).not.toBe(k1.thumbprint);
  });

  describe('DPoP exchange-proof enforcement', () => {
    function baseReq() {
      return request(ctx.app)
        .post('/oauth2/token')
        .set('Host', BROKER_HOST)
        .set('authorization', basicAuth('calling-service', 'calling-secret'))
        .type('form');
    }
    const validBody = {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: '',
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      audience: 'receiving',
      scope: 'lending/write',
    };

    it('rejects a missing DPoP proof with invalid_dpop_proof', async () => {
      const res = await baseReq().send({ ...validBody, subject_token: userJwt });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_dpop_proof');
    });

    it('rejects a bad-signature proof', async () => {
      const proof = await freshProof();
      const parts = proof.split('.');
      const tampered = `${parts[0]}.${parts[1]}.AAAA${parts[2]?.slice(4) ?? ''}`;
      const res = await baseReq().set('DPoP', tampered).send({ ...validBody, subject_token: userJwt });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_dpop_proof');
    });

    it('rejects a wrong-htm proof', async () => {
      const proof = await signDpopProof({ key: dpopKey, htm: 'GET', htu: BROKER_HTU });
      const res = await baseReq().set('DPoP', proof).send({ ...validBody, subject_token: userJwt });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_dpop_proof');
    });

    it('rejects a wrong-htu proof', async () => {
      const proof = await signDpopProof({ key: dpopKey, htu: 'http://evil.test/oauth2/token' });
      const res = await baseReq().set('DPoP', proof).send({ ...validBody, subject_token: userJwt });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_dpop_proof');
    });

    it('rejects a stale-iat proof', async () => {
      const staleIat = Math.floor(Date.now() / 1000) - 600;
      const proof = await signDpopProof({ key: dpopKey, htu: BROKER_HTU, iat: staleIat });
      const res = await baseReq().set('DPoP', proof).send({ ...validBody, subject_token: userJwt });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_dpop_proof');
    });

    it('rejects a replayed-jti proof', async () => {
      const jti = 'fixed-jti-for-replay';
      const proofA = await signDpopProof({ key: dpopKey, htu: BROKER_HTU, jti });
      const first = await baseReq().set('DPoP', proofA).send({ ...validBody, subject_token: userJwt });
      expect(first.status).toBe(200);
      // Re-sign with the SAME jti (fresh iat) → replay rejection.
      const proofB = await signDpopProof({ key: dpopKey, htu: BROKER_HTU, jti });
      const second = await baseReq().set('DPoP', proofB).send({ ...validBody, subject_token: userJwt });
      expect(second.status).toBe(401);
      expect(second.body.error).toBe('invalid_dpop_proof');
    });
  });
});
