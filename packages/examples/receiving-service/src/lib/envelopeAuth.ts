/**
 * Wraps Plan 01's `createVerifyEnvelope` / `createAuthorize` factories so the
 * SQS consumer can call simple `verifyEnvelope(msg, opts)` and `authorize(input)`
 * shapes. `initEnvelopeAuth(config)` is called at process boot from index.ts.
 *
 * Unit tests mock this module wholesale (no init call), so the lazy `verifyFn`
 * / `authorizeFn` shape preserves test compatibility.
 */
import { VerifiedPermissionsClient, IsAuthorizedWithTokenCommand } from '@aws-sdk/client-verifiedpermissions';
import {
  createVerifyEnvelope,
  createAuthorize,
  createCedarLocal,
  getRedisClient,
} from '@s2s/auth-library';
import type { VerifiedEnvelope, AuthorizationResult } from '@s2s/auth-library';
import type { ReceivingServiceConfig } from '../config.js';

type VerifyFn = (msg: { envelope: string; payload: object | Buffer }, opts: { expectedQueueArn: string }) => Promise<VerifiedEnvelope>;
type AuthorizeFn = (input: { principal: string; action: string; resource: string; token?: string; context?: Record<string, unknown> }) => Promise<AuthorizationResult>;

let verifyFn: VerifyFn | null = null;
let authorizeFn: AuthorizeFn | null = null;

export function setEnvelopeAuth(deps: { verify?: VerifyFn; authorize?: AuthorizeFn }): void {
  if (deps.verify) verifyFn = deps.verify;
  if (deps.authorize) authorizeFn = deps.authorize;
}

/**
 * Wire the real `createVerifyEnvelope` (Redis-backed dedup) and `createAuthorize`
 * (AVP `IsAuthorizedWithToken`) factories. Idempotent — re-init is a no-op.
 */
export function initEnvelopeAuth(config: ReceivingServiceConfig): void {
  if (verifyFn !== null && authorizeFn !== null) return;
  const redis = getRedisClient(config.redisEndpoint);
  verifyFn = createVerifyEnvelope({ redis });

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
  const fn = createAuthorize({
    mode: 'avp_api',
    policyStoreId: config.policyStoreId,
    avpClient,
    cedarLocal: createCedarLocal([]),
    fallbackToLocal: false,
  });
  // Consumer path has no end-user token; pass empty-string to AVP. AVP accepts
  // calls where only Cedar context attributes (scopes, dpop_confirmed) drive
  // the decision via the resource policy.
  authorizeFn = (input) => fn({ ...input, token: input.token ?? '' });
}

export async function verifyEnvelope(
  msg: { envelope: string; payload: object | Buffer },
  opts: { expectedQueueArn: string },
): Promise<VerifiedEnvelope> {
  if (!verifyFn) throw new Error('envelopeAuth not initialized — call initEnvelopeAuth or setEnvelopeAuth first');
  return verifyFn(msg, opts);
}

export async function authorize(
  input: { principal: string; action: string; resource: string; token?: string; context?: Record<string, unknown> },
): Promise<AuthorizationResult> {
  if (!authorizeFn) throw new Error('envelopeAuth not initialized — call initEnvelopeAuth or setEnvelopeAuth first');
  return authorizeFn(input);
}
