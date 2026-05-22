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

/**
 * RFC 9449 §6 confirmation claim binding a token to a DPoP key.
 * `jkt` is the base64url-encoded SHA-256 JWK thumbprint of the key.
 */
export interface CnfClaim {
  jkt?: string;
}

export interface ValidatedToken {
  sub: string;
  scope: string[];
  iss: string;
  aud: string;
  exp: number;
  /** RFC 9449 confirmation claim (present when the broker sender-constrains the token). */
  cnf?: CnfClaim;
  raw: Record<string, unknown>;
}

export interface UserContext {
  /** Subject from the user token (e.g., "user-alice") */
  sub: string;
  /** Roles claim, normalised to an array */
  roles: string[];
  /** Groups claim, normalised to an array (empty if absent) */
  groups: string[];
  /** Other custom claims preserved as-is */
  claims: Record<string, unknown>;
  /** The original issuer URL (USER_ISSUER_URL or equivalent) */
  issuer: string;
}

/** Actor chain claim per RFC 8693 section 4.1. Recursive: each `act` may itself contain another `act`. */
export interface ActorChain {
  /** Service principal of this hop */
  sub: string;
  /** The hop above this one */
  act?: ActorChain;
}

/** The result of validating an exchanged token that carries user + actor context. */
export interface ValidatedExchangedToken extends ValidatedToken {
  user: UserContext;
  actor_chain: ActorChain;
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
