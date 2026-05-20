export const VERSION = '0.1.0';

export { initKeyPair, getPublicJwk, getJwkThumbprint, rotateKey, getActiveKeys, shouldRotate } from './dpop/keyManager.js';
export { signDPoP } from './dpop/signDPoP.js';
export { createVerifyDPoP } from './dpop/verifyDPoP.js';
export { generateDPoPNonce, createRedisNonceStore } from './dpop/dpopNonce.js';
export { createAcquireToken } from './token/acquireToken.js';
export { acquireTokenRaw, CognitoTokenError } from './token/acquireTokenRaw.js';
export { acquireTokenWithRetry } from './token/acquireTokenRetry.js';
export { TokenCache, cacheKey } from './token/tokenCache.js';
export { createJwksManager } from './validation/jwksManager.js';
export { createValidateToken } from './validation/validateToken.js';
export { createAuthorize } from './authz/authorize.js';
export { createCedarLocal } from './authz/cedarLocal.js';
export { signEnvelope } from './envelope/signEnvelope.js';
export { createVerifyEnvelope, DEFAULT_STALENESS } from './envelope/verifyEnvelope.js';
export { createAuthMiddleware } from './middleware.js';
export { buildBreaker } from './resilience/circuitBreaker.js';
export { loadConfig } from './config.js';
export { metrics } from './observability/metrics.js';
export { getLogger, redact, truncateHash } from './observability/logger.js';
export { withSpan, SPAN_NAMES } from './observability/tracing.js';
export { getClientSecret, invalidateClientSecret } from './secrets.js';
export { getRedisClient, buildRedis, pingRedis } from './redisClient.js';
export { jwksLastRefreshAt } from './validation/jwksManager.js';
export { AuthError, ERROR_CODES, buildErrorBody, wwwAuthenticateHeader } from './errors.js';

export type {
  TokenResult,
  DPoPProof,
  DPoPVerificationResult,
  DPoPClaims,
  DPoPNonce,
  NonceStore,
  SignedMessage,
  VerifiedEnvelope,
  ValidatedToken,
  AuthorizationResult,
  AuthLibraryConfig,
  PublicJwk,
  StalenessQueueType,
} from './types.js';
