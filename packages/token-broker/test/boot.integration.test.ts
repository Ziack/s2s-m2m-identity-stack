/**
 * Broker boot integration test — exercises the env-var contract between
 * `modules/s2s-platform/broker.tf` and `packages/token-broker/src/config.ts`.
 *
 * This test is the missing link in the v2.0.3-and-earlier deploy story: TF
 * tests assert TF shape, vitest unit tests assert TS behavior, but nothing
 * tied the two together. If a future change drops or renames an env var on
 * either side of the contract, this test fails CI.
 *
 * The `tfEnv` fixture mirrors the `environment` array in broker.tf one-for-
 * one. Keep them in sync.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { makeRsaKey, type TestKeyMaterial } from './helpers/testFixtures.js';

// Stub @s2s/auth-library before the broker imports it. The signing key + actor
// catalog loaders both call getClientSecret; we route them to in-memory
// fixtures so the test never reaches AWS. The redis client is replaced with
// a Map-backed stub that responds to ping/set/get/expire.
let signingPemFixture = '';
const fakeRedis: {
  store: Map<string, string>;
  ping: () => Promise<string>;
  set: (k: string, v: string, ...args: unknown[]) => Promise<string | null>;
  get: (k: string) => Promise<string | null>;
  expire: () => Promise<number>;
} = {
  store: new Map(),
  ping: async () => 'PONG',
  async set(k, v, ...args) {
    const nx = args.includes('NX');
    if (nx && this.store.has(k)) return null;
    this.store.set(k, v);
    return 'OK';
  },
  async get(k) {
    return this.store.get(k) ?? null;
  },
  async expire() {
    return 1;
  },
};

vi.mock('@s2s/auth-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@s2s/auth-library')>();
  return {
    ...actual,
    getClientSecret: async (arn: string) => {
      if (arn.includes('signing')) return signingPemFixture;
      if (arn.includes('actor-catalog')) return JSON.stringify({});
      throw new Error(`unexpected secret arn in boot test: ${arn}`);
    },
    getRedisClient: () => fakeRedis as unknown as ReturnType<typeof actual.getRedisClient>,
  };
});

// ---- TF env fixture — mirror modules/s2s-platform/broker.tf ----------------
//
// Every key here corresponds to an entry in the `environment` array of the
// broker container_definitions in broker.tf. The values are stand-ins shaped
// like the real ones (ARN format, URL format) — the broker only cares about
// shape at boot, not whether the AWS resources exist.
const tfEnv: Record<string, string> = {
  BROKER_ISSUER_URL: 'https://broker.test.s2s',
  BROKER_SIGNING_KEY_SECRET_ARN:
    'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-s2s/broker/signing-key-AbCdEf',
  ACTOR_CATALOG_SECRET_ARN:
    'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-s2s/platform/broker/actor-catalog-GhIjKl',
  USER_ISSUER_URL: 'https://idp.test.example',
  USER_ISSUER_AUDIENCE: 'platform',
  REDIS_ENDPOINT: 'redis://valkey.test.local:6379',
  REDIS_PORT: '6379',
  USER_POOL_ID: 'us-east-1_TESTPOOL',
  COGNITO_DOMAIN: 'test-s2s',
  AWS_REGION: 'us-east-1',
  PORT: '8080',
};

const savedEnv: Record<string, string | undefined> = {};

describe('broker boot — TF env-var contract', () => {
  let km: TestKeyMaterial;

  beforeAll(async () => {
    km = await makeRsaKey();
    signingPemFixture = km.privatePem;
    for (const [k, v] of Object.entries(tfEnv)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
  });

  afterAll(() => {
    for (const k of Object.keys(tfEnv)) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('loadConfig() returns a valid TokenBrokerConfig from the TF-shaped env', async () => {
    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();
    // Every requireEnv() field must be non-empty.
    expect(cfg.brokerIssuerUrl).toBe('https://broker.test.s2s');
    expect(cfg.brokerSigningKeySecretArn).toBe(tfEnv.BROKER_SIGNING_KEY_SECRET_ARN);
    expect(cfg.userIssuerUrl).toBe('https://idp.test.example');
    expect(cfg.userIssuerAudience).toBe('platform');
    expect(cfg.redisEndpoint).toBe('redis://valkey.test.local:6379');
    // Either path or arn must be set; broker.tf provides the arn.
    expect(cfg.actorCatalogSecretArn).toBe(tfEnv.ACTOR_CATALOG_SECRET_ARN);
    expect(cfg.actorCatalogPath).toBeUndefined();
    // PORT/AWS_REGION mirrored from TF.
    expect(cfg.port).toBe(8080);
    expect(cfg.awsRegion).toBe('us-east-1');
  });

  it('buildApp() boots end-to-end without throwing and /health returns 200', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { buildApp } = await import('../src/index.js');
    const cfg = loadConfig();
    const app = await buildApp(cfg);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('fails fast if a single TF env var is missing — regression guard', async () => {
    const saved = process.env.BROKER_ISSUER_URL;
    delete process.env.BROKER_ISSUER_URL;
    try {
      // Re-import via dynamic import + a fresh module URL so the module cache
      // doesn't serve a stale loadConfig closure. (loadConfig reads
      // process.env on every call, so cache isn't actually an issue here, but
      // be explicit.)
      const { loadConfig } = await import('../src/config.js');
      expect(() => loadConfig()).toThrow(/BROKER_ISSUER_URL/);
    } finally {
      process.env.BROKER_ISSUER_URL = saved;
    }
  });
});
