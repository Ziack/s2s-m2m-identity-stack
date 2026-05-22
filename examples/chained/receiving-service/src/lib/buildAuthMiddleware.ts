/**
 * Constructs the SDK's `createAuthMiddleware` with real, production-ready
 * dependencies wired from Plan 01's factory exports:
 *   - validateToken: JWKS-backed RS256 verification (createValidateToken)
 *   - verifyDPoP:    Redis nonce store + jti dedup (createVerifyDPoP)
 *   - authorize:     AVP `IsAuthorizedWithToken` with local Cedar fallback
 *                    disabled (createAuthorize, mode='avp_api')
 *
 * The middleware enforces `requireDPoP: true` per RFC 9449 §8.
 */
import type { RequestHandler } from 'express';
import { VerifiedPermissionsClient, IsAuthorizedWithTokenCommand } from '@aws-sdk/client-verifiedpermissions';
import {
  createAuthMiddleware,
  createValidateToken,
  createVerifyDPoP,
  createAuthorize,
  createCedarLocal,
  createJwksManager,
  getRedisClient,
} from '@s2s/auth-library';
import type { ReceivingServiceConfig } from '../config.js';
import { createNonceStore } from './nonceStore.js';

export function buildAuthMiddleware(config: ReceivingServiceConfig): RequestHandler {
  const redis = getRedisClient(config.redisEndpoint);
  const nonceStore = createNonceStore(config.redisEndpoint);

  const jwksManager = createJwksManager({
    jwksUri: config.jwksUri,
    refreshHours: config.jwksRefreshHours,
  });
  const validateToken = createValidateToken({
    jwksManager,
    expectedIssuer: config.expectedIssuer,
  });
  const verifyDPoP = createVerifyDPoP({
    redis,
    nonceStore,
    requireNonce: true,
    nonceTtlSeconds: config.nonceTtlSeconds,
  });

  // AVP client — JS SDK call signature is camelCase, but the createAuthorize
  // factory's AvpClientLike shape uses PascalCase fields (matching the wire
  // protocol). Adapt at the boundary.
  const avpRaw = new VerifiedPermissionsClient({ region: config.awsRegion });
  const avpClient = {
    async isAuthorizedWithToken(input: Parameters<NonNullable<Parameters<typeof createAuthorize>[0]['avpClient']['isAuthorizedWithToken']>>[0]) {
      const resp = await avpRaw.send(new IsAuthorizedWithTokenCommand({
        policyStoreId: input.PolicyStoreId,
        accessToken: input.AccessToken,
        identityToken: input.IdentityToken,
        action: { actionType: input.Action.ActionType, actionId: input.Action.ActionId },
        resource: { entityType: input.Resource.EntityType, entityId: input.Resource.EntityId },
        ...(input.Context
          ? { context: { contextMap: input.Context.ContextMap as Record<string, never> } }
          : {}),
      }));
      return {
        Decision: (resp.decision === 'ALLOW' ? 'ALLOW' : 'DENY') as 'ALLOW' | 'DENY',
        DeterminingPolicies: (resp.determiningPolicies ?? []).map((p) => ({ PolicyId: p.policyId ?? '' })),
      };
    },
  };

  const cedarLocal = createCedarLocal([]);
  const authorize = createAuthorize({
    mode: 'avp_api',
    policyStoreId: config.policyStoreId,
    avpClient,
    cedarLocal,
    fallbackToLocal: false,
  });

  return createAuthMiddleware({
    expectedAudience: config.expectedAudience,
    resourcePrefix: config.resourcePrefix,
    validateToken,
    verifyDPoP,
    authorize,
    requireDPoP: true,
  });
}
