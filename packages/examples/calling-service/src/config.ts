export interface CallingServiceConfig {
  port: number;
  clientId: string;
  cognitoDomain: string;
  clientSecretArn: string;
  redisEndpoint: string;
  targetBaseUrl: string;
  targetAudience: string;
  scopes: string[];
  queueUrl: string;
  queueArn: string;
  awsRegion: string;
  logLevel: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function loadConfig(): CallingServiceConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    clientId: requireEnv('COGNITO_CLIENT_ID'),
    cognitoDomain: requireEnv('COGNITO_DOMAIN'),
    clientSecretArn: requireEnv('M2M_CLIENT_SECRET_ARN'),
    redisEndpoint: requireEnv('REDIS_ENDPOINT'),
    targetBaseUrl: requireEnv('TARGET_BASE_URL'),
    targetAudience: requireEnv('TARGET_AUDIENCE'),
    scopes: requireEnv('TARGET_SCOPES').split(',').map((s) => s.trim()),
    queueUrl: requireEnv('LENDING_QUEUE_URL'),
    queueArn: requireEnv('LENDING_QUEUE_ARN'),
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}
