import type { AuthLibraryConfig } from './types.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Required env var missing: ${name}`);
  }
  return v;
}

function intOr(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer for ${name}: ${v}`);
  return n;
}

function boolOr(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v.toLowerCase() === 'true';
}

export function loadConfig(): AuthLibraryConfig {
  const policyMode = (process.env.M2M_POLICY_MODE ?? 'avp_api') as 'avp_api' | 'local_cedar';
  if (policyMode !== 'avp_api' && policyMode !== 'local_cedar') {
    throw new Error(`Invalid M2M_POLICY_MODE: ${policyMode}`);
  }
  const telemetryLevel = (process.env.M2M_TELEMETRY_LEVEL ?? 'full') as 'metrics' | 'traces' | 'full';
  return {
    cognitoDomain: required('COGNITO_DOMAIN'),
    cognitoClientId: required('COGNITO_CLIENT_ID'),
    m2mClientSecretArn: required('M2M_CLIENT_SECRET_ARN'),
    redisEndpoint: required('REDIS_ENDPOINT'),
    avpPolicyStoreId: required('AVP_POLICY_STORE_ID'),
    tokenTtlSeconds: intOr('M2M_TOKEN_TTL_SECONDS', 300),
    dpopAlgorithm: 'ES256',
    dpopKeyLifetimeSeconds: intOr('M2M_DPOP_KEY_LIFETIME', 86400),
    nonceTtlSeconds: intOr('M2M_NONCE_TTL_SECONDS', 120),
    jwksRefreshHours: intOr('M2M_JWKS_REFRESH_HOURS', 24),
    policyMode,
    cbThreshold: intOr('M2M_CB_THRESHOLD', 5),
    telemetryLevel,
    testMode: boolOr('M2M_TEST_MODE', false),
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  };
}
