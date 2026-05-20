import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    process.env = {
      ...process.env,
      COGNITO_DOMAIN: 'https://example.auth.us-east-1.amazoncognito.com',
      COGNITO_CLIENT_ID: 'client-abc',
      M2M_CLIENT_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:x',
      REDIS_ENDPOINT: 'rediss://example.cache.amazonaws.com:6379',
      AVP_POLICY_STORE_ID: 'ps-xyz',
    };
    delete process.env.M2M_TOKEN_TTL_SECONDS;
    delete process.env.M2M_TEST_MODE;
  });

  it('loads required env and applies defaults', () => {
    const cfg = loadConfig();
    expect(cfg.cognitoClientId).toBe('client-abc');
    expect(cfg.tokenTtlSeconds).toBe(300);
    expect(cfg.dpopAlgorithm).toBe('ES256');
    expect(cfg.dpopKeyLifetimeSeconds).toBe(86400);
    expect(cfg.nonceTtlSeconds).toBe(120);
    expect(cfg.policyMode).toBe('avp_api');
    expect(cfg.cbThreshold).toBe(5);
    expect(cfg.testMode).toBe(false);
  });

  it('throws when required env missing', () => {
    delete process.env.COGNITO_DOMAIN;
    expect(() => loadConfig()).toThrow(/COGNITO_DOMAIN/);
  });

  it('parses boolean M2M_TEST_MODE', () => {
    process.env.M2M_TEST_MODE = 'true';
    expect(loadConfig().testMode).toBe(true);
  });
});
