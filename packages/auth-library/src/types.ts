import type { JWK } from 'jose';

export interface TokenResult {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  tokenSource: 'cognito' | 'cache-l1' | 'cache-l2';
}

export interface DPoPProof {
  proof: string;
  jti: string;
}

export interface DPoPVerificationResult {
  ok: true;
  jti: string;
  jwkThumbprint: string;
  iat: number;
}

export interface SignedMessage {
  envelope: string;
  payload: object | Buffer;
  metadata: {
    jti: string;
    iat: number;
    bodyHash: string;
    envelopeSizeBytes: number;
  };
}

export interface VerifiedEnvelope {
  principal: string;
  action: string;
  claims: Record<string, unknown>;
  verifiedAt: string;
  verificationDurationMs: number;
}

export interface ValidatedToken {
  sub: string;
  scope: string[];
  iss: string;
  aud: string;
  exp: number;
  raw: Record<string, unknown>;
}

export interface AuthorizationResult {
  decision: 'ALLOW' | 'DENY';
  reasons: string[];
  evaluationTimeMs: number;
  mode: 'api' | 'local' | 'cache';
}

export interface AuthLibraryConfig {
  cognitoDomain: string;
  cognitoClientId: string;
  m2mClientSecretArn: string;
  redisEndpoint: string;
  avpPolicyStoreId: string;
  tokenTtlSeconds: number;
  dpopAlgorithm: 'ES256';
  dpopKeyLifetimeSeconds: number;
  nonceTtlSeconds: number;
  jwksRefreshHours: number;
  policyMode: 'avp_api' | 'local_cedar';
  cbThreshold: number;
  telemetryLevel: 'metrics' | 'traces' | 'full';
  testMode: boolean;
  awsRegion: string;
}

export interface PublicJwk extends JWK {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export type StalenessQueueType = 'sqs_standard' | 'sqs_fifo' | 'dlq' | 'eventbridge';

export interface DPoPClaims {
  htm: string;
  htu: string;
  jti: string;
  iat: number;
  ath?: string;
  nonce?: string;
}

export type DPoPNonce = string;

export interface NonceStore {
  issue(nonce: DPoPNonce): Promise<void>;
  consume(nonce: DPoPNonce): Promise<boolean>;
}
