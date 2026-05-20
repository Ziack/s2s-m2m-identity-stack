/**
 * Constructs the SDK's `createAuthMiddleware` for the ledger-service.
 * Same SDK factories as receiving-service — only audience, resource prefix
 * and AVP policy store differ (configured via `LedgerServiceConfig`).
 *
 * RFC 9449 §8: `requireDPoP: true` is enforced.
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
import type { LedgerServiceConfig } from '../config.js';
import { createNonceStore } from './nonceStore.js';

export function buildAuthMiddleware(config: LedgerServiceConfig): RequestHandler {
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

  const avpRaw = new VerifiedPermissionsClient({ region: config.awsRegion });
  const avpClient = {
    async isAuthorizedWithToken(input: Parameters<Parameters<typeof createAuthorize>[0]['avpClient']['isAuthorizedWithToken']>[0]) {
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
