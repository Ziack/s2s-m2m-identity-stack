export interface ReceivingServiceConfig {
  port: number;
  expectedAudience: string;
  expectedIssuer: string;
  jwksUri: string;
  jwksRefreshHours: number;
  nonceTtlSeconds: number;
  policyStoreId: string;
  resourcePrefix: string;
  queueUrl: string;
  queueArn: string;
  redisEndpoint: string;
  awsRegion: string;
  logLevel: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadConfig(): ReceivingServiceConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    expectedAudience: requireEnv('EXPECTED_AUDIENCE'),
    expectedIssuer: requireEnv('EXPECTED_ISSUER'),
    jwksUri: requireEnv('JWKS_URI'),
    jwksRefreshHours: Number(process.env.JWKS_REFRESH_HOURS ?? 1),
    nonceTtlSeconds: Number(process.env.NONCE_TTL_SECONDS ?? 120),
    policyStoreId: requireEnv('AVP_POLICY_STORE_ID'),
    resourcePrefix: requireEnv('RESOURCE_PREFIX'),
    queueUrl: requireEnv('LENDING_QUEUE_URL'),
    queueArn: requireEnv('LENDING_QUEUE_ARN'),
    redisEndpoint: requireEnv('REDIS_ENDPOINT'),
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}
