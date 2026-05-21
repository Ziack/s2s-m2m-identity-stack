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
  // Phase 3: user-issuer (local IdP) configuration
  userIssuerUrl: string;
  userIssuerAudience: string;
  userIssuerSigningKeySecretArn?: string;
  userIssuerDevKeyPem?: string;
  // Phase 3: token-broker configuration
  brokerTokenEndpoint: string;
  brokerActorClientId: string;
  brokerActorSecretArn: string;
  receivingServiceUrl: string;
  nodeEnv: string;
  // Phase 4: VPC Lattice outbound (SigV4). When useLattice is true, outbound
  // calls target the *LatticeDns endpoints and are SigV4-signed.
  useLattice: boolean;
  receivingLatticeDns: string;
  brokerLatticeDns: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function loadConfig(): CallingServiceConfig {
  const cfg: CallingServiceConfig = {
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
    userIssuerUrl: requireEnv('USER_ISSUER_URL'),
    userIssuerAudience: requireEnv('USER_ISSUER_AUDIENCE'),
    brokerTokenEndpoint: requireEnv('BROKER_TOKEN_ENDPOINT'),
    brokerActorClientId: requireEnv('BROKER_ACTOR_CLIENT_ID'),
    brokerActorSecretArn: requireEnv('BROKER_ACTOR_SECRET_ARN'),
    receivingServiceUrl: process.env.RECEIVING_SERVICE_URL ?? process.env.TARGET_BASE_URL ?? '',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    useLattice: (process.env.USE_LATTICE ?? '').toLowerCase() === 'true',
    receivingLatticeDns: process.env.RECEIVING_LATTICE_DNS ?? '',
    brokerLatticeDns: process.env.BROKER_LATTICE_DNS ?? '',
  };
  const arn = process.env.USER_ISSUER_SIGNING_KEY_SECRET_ARN;
  const devPem = process.env.USER_ISSUER_DEV_KEY_PEM;
  if (!arn && !devPem) {
    throw new Error(
      'Missing required env var: USER_ISSUER_SIGNING_KEY_SECRET_ARN (or USER_ISSUER_DEV_KEY_PEM for dev)',
    );
  }
  if (arn) cfg.userIssuerSigningKeySecretArn = arn;
  if (devPem) cfg.userIssuerDevKeyPem = devPem;
  return cfg;
}
