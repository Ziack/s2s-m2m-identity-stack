export interface TokenBrokerConfig {
  port: number;
  awsRegion: string;
  logLevel: string;
  /** Broker's own issuer URL (e.g., https://broker.s2s/auth) */
  brokerIssuerUrl: string;
  /** Secrets Manager ARN holding the broker's RSA private key (PEM PKCS8). */
  brokerSigningKeySecretArn: string;
  /** The local user IdP issuer URL (e.g., https://calling-service/auth). */
  userIssuerUrl: string;
  /** Expected audience on inbound user tokens. */
  userIssuerAudience: string;
  /** JWKS URI of the user issuer. Defaults to `${userIssuerUrl}/.well-known/jwks.json`. */
  userIssuerJwksUri: string;
  /** Path to the actor catalog JSON file. */
  actorCatalogPath: string;
  /** Redis URL for jti replay store. */
  redisEndpoint: string;
  /** Whether the broker mandates DPoP-bound tokens (advertised as token_type). */
  dpopRequired: boolean;
  /** Exchanged-token TTL (seconds). RFC8693 — broker-issued tokens are short-lived. */
  exchangedTokenTtlSeconds: number;
  /** Replay window for jti dedup (seconds). */
  replayTtlSeconds: number;
  /** JWKS cache TTL hours for inbound user issuer JWKS / broker re-entry. */
  jwksRefreshHours: number;
  /** Signing key cache TTL ms (Secrets Manager). */
  signingKeyTtlMs: number;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadConfig(): TokenBrokerConfig {
  const brokerIssuerUrl = requireEnv('BROKER_ISSUER_URL').replace(/\/$/, '');
  const userIssuerUrl = requireEnv('USER_ISSUER_URL').replace(/\/$/, '');
  return {
    port: Number(process.env.PORT ?? 3000),
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    brokerIssuerUrl,
    brokerSigningKeySecretArn: requireEnv('BROKER_SIGNING_KEY_SECRET_ARN'),
    userIssuerUrl,
    userIssuerAudience: requireEnv('USER_ISSUER_AUDIENCE'),
    userIssuerJwksUri: process.env.USER_ISSUER_JWKS_URI ?? `${userIssuerUrl}/.well-known/jwks.json`,
    actorCatalogPath: requireEnv('ACTOR_CATALOG_PATH'),
    redisEndpoint: requireEnv('REDIS_ENDPOINT'),
    dpopRequired: (process.env.DPOP_REQUIRED ?? 'true') !== 'false',
    exchangedTokenTtlSeconds: Number(process.env.EXCHANGED_TOKEN_TTL_SECONDS ?? 600),
    replayTtlSeconds: Number(process.env.REPLAY_TTL_SECONDS ?? 600),
    jwksRefreshHours: Number(process.env.JWKS_REFRESH_HOURS ?? 1),
    signingKeyTtlMs: Number(process.env.SIGNING_KEY_TTL_MS ?? 3_600_000),
  };
}
