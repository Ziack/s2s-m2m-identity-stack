export const VERSION = '0.1.0';

export { initKeyPair, getPublicJwk, getJwkThumbprint, rotateKey, getActiveKeys, shouldRotate } from './dpop/keyManager.js';
export { signDPoP } from './dpop/signDPoP.js';
export { withDPoPNonceRetry, type NonceAwareFn } from './dpop/withDPoPNonceRetry.js';
export { createVerifyDPoP } from './dpop/verifyDPoP.js';
export { generateDPoPNonce, createRedisNonceStore } from './dpop/dpopNonce.js';
export { createAcquireToken } from './token/acquireToken.js';
export { acquireTokenRaw, CognitoTokenError } from './token/acquireTokenRaw.js';
export { acquireTokenWithRetry } from './token/acquireTokenRetry.js';
export { TokenCache, cacheKey } from './token/tokenCache.js';
export { createJwksManager } from './validation/jwksManager.js';
export { createValidateToken } from './validation/validateToken.js';
export { createValidateUserToken } from './auth/validateUserToken.js';
export type {
  ValidateUserTokenOptions,
  ValidateUserTokenInput,
  ValidateUserTokenFn,
} from './auth/validateUserToken.js';
export { createExchangeToken } from './auth/exchangeToken.js';
export type {
  ExchangeTokenOptions,
  ExchangeTokenInput,
  ExchangeTokenResult,
  ExchangeTokenFn,
} from './auth/exchangeToken.js';
export { signUserJwt } from './auth/signUserJwt.js';
export type { SignUserJwtOptions, SignUserJwtInput } from './auth/signUserJwt.js';
export { extractActorChain } from './auth/extractActorChain.js';
export { createAuthorize } from './authz/authorize.js';
export { createCedarLocal } from './authz/cedarLocal.js';
export { signEnvelope } from './envelope/signEnvelope.js';
export { createVerifyEnvelope, DEFAULT_STALENESS } from './envelope/verifyEnvelope.js';
export { createAuthMiddleware, createBrokerAuthMiddleware, type BrokerAuthMode } from './middleware.js';
export { buildBreaker } from './resilience/circuitBreaker.js';
export { loadConfig } from './config.js';
export { metrics } from './observability/metrics.js';
export { getLogger, redact, truncateHash } from './observability/logger.js';
export { withSpan, SPAN_NAMES } from './observability/tracing.js';
export { getClientSecret, invalidateClientSecret } from './secrets.js';
export { getRedisClient, buildRedis, pingRedis, setRedisClientForTest, resetRedisClientForTest } from './redisClient.js';
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
  UserContext,
  ActorChain,
  ValidatedExchangedToken,
} from './types.js';
