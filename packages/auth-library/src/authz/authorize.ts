import type { AuthorizationResult } from '../types.js';
import type { CedarLocalEngine } from './cedarLocal.js';
import { metrics } from '../observability/metrics.js';
import { withSpan, SPAN_NAMES } from '../observability/tracing.js';
import { getLogger } from '../observability/logger.js';
import { toAvpContextMap, type AvpAttributeValue } from './avpContext.js';

export interface AvpClientLike {
  isAuthorizedWithToken(input: {
    PolicyStoreId: string;
    IdentityToken?: string;
    AccessToken?: string;
    Action: { ActionType: string; ActionId: string };
    Resource: { EntityType: string; EntityId: string };
    Context?: { ContextMap: Record<string, AvpAttributeValue> };
  }): Promise<{ Decision: 'ALLOW' | 'DENY'; DeterminingPolicies?: Array<{ PolicyId: string }> }>;
  isAuthorized?(input: {
    PolicyStoreId: string;
    Principal: { EntityType: string; EntityId: string };
    Action: { ActionType: string; ActionId: string };
    Resource: { EntityType: string; EntityId: string };
    Context?: { ContextMap: Record<string, AvpAttributeValue> };
  }): Promise<{ Decision: 'ALLOW' | 'DENY'; DeterminingPolicies?: Array<{ PolicyId: string }> }>;
}

export interface AuthorizeDeps {
  mode: 'avp_api' | 'local_cedar';
  /** 'token' = IsAuthorizedWithToken, 'entity' = IsAuthorized for tokenless paths; default 'token'. */
  avpApi?: 'token' | 'entity';
  policyStoreId: string;
  avpClient: AvpClientLike;
  cedarLocal: CedarLocalEngine;
  fallbackToLocal?: boolean;
  cacheTtlMs?: number;
  nowFn?: () => number;
}

export interface AuthorizeInput {
  principal: string;
  action: string;
  resource: string;
  token: string;
  context?: Record<string, unknown>;
}

export type AuthorizeFn = (input: AuthorizeInput) => Promise<AuthorizationResult>;

interface CacheEntry { result: AuthorizationResult; storedAtMs: number }

export function createAuthorize(deps: AuthorizeDeps): AuthorizeFn {
  const ttl = deps.cacheTtlMs ?? 30_000;
  const now = deps.nowFn ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const log = getLogger();

  function splitAction(action: string): { type: string; id: string } {
    const idx = action.lastIndexOf('::');
    if (idx === -1) return { type: 'Action', id: action };
    return { type: action.slice(0, idx), id: action.slice(idx + 2) };
  }
  function splitResource(resource: string): { type: string; id: string } {
    const idx = resource.lastIndexOf('::');
    if (idx === -1) return { type: 'Resource', id: resource };
    return { type: resource.slice(0, idx), id: resource.slice(idx + 2) };
  }
  function splitEntity(entity: string): { type: string; id: string } {
    const idx = entity.lastIndexOf('::');
    if (idx === -1) return { type: 'Entity', id: entity };
    return { type: entity.slice(0, idx), id: entity.slice(idx + 2) };
  }

  return async function authorize(input: AuthorizeInput): Promise<AuthorizationResult> {
    return withSpan(SPAN_NAMES.AUTHZ_EVALUATE, async () => {
      const start = process.hrtime.bigint();
      const key = `${input.principal}:${input.action}:${input.resource}`;
      const cached = cache.get(key);
      if (cached && now() - cached.storedAtMs < ttl) {
        return { ...cached.result, mode: 'cache' as const };
      }
      let result: AuthorizationResult;
      if (deps.mode === 'avp_api') {
        try {
          const act = splitAction(input.action);
          const res = splitResource(input.resource);
          const ctxMap = input.context ? toAvpContextMap(input.context) : undefined;
          let resp: { Decision: 'ALLOW' | 'DENY'; DeterminingPolicies?: Array<{ PolicyId: string }> };
          if ((deps.avpApi ?? 'token') === 'entity') {
            if (!deps.avpClient.isAuthorized) {
              throw new Error("avpApi:'entity' requires an avpClient.isAuthorized implementation");
            }
            const prin = splitEntity(input.principal);
            const req: Parameters<NonNullable<typeof deps.avpClient.isAuthorized>>[0] = {
              PolicyStoreId: deps.policyStoreId,
              Principal: { EntityType: prin.type, EntityId: prin.id },
              Action: { ActionType: act.type, ActionId: act.id },
              Resource: { EntityType: res.type, EntityId: res.id },
            };
            if (ctxMap) req.Context = { ContextMap: ctxMap };
            resp = await deps.avpClient.isAuthorized(req);
          } else {
            const req: Parameters<typeof deps.avpClient.isAuthorizedWithToken>[0] = {
              PolicyStoreId: deps.policyStoreId,
              AccessToken: input.token,
              Action: { ActionType: act.type, ActionId: act.id },
              Resource: { EntityType: res.type, EntityId: res.id },
            };
            if (ctxMap) req.Context = { ContextMap: ctxMap };
            resp = await deps.avpClient.isAuthorizedWithToken(req);
          }
          const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
          result = {
            decision: resp.Decision,
            reasons: (resp.DeterminingPolicies ?? []).map((p) => p.PolicyId),
            evaluationTimeMs: elapsed,
            mode: 'api',
          };
        } catch (err) {
          if (deps.fallbackToLocal) {
            result = deps.cedarLocal.evaluate({
              principal: input.principal,
              action: input.action,
              resource: input.resource,
              context: (input.context ?? {}) as Record<string, unknown> & { scopes?: string[] },
            });
          } else {
            throw err;
          }
        }
      } else {
        result = deps.cedarLocal.evaluate({
          principal: input.principal,
          action: input.action,
          resource: input.resource,
          context: (input.context ?? {}) as Record<string, unknown> & { scopes?: string[] },
        });
      }
      cache.set(key, { result, storedAtMs: now() });
      metrics.avpDecisionDuration.observe({ result: result.decision === 'ALLOW' ? 'allow' : 'deny', mode: result.mode === 'cache' ? 'api' : result.mode }, result.evaluationTimeMs / 1000);
      log.info({ authz_decision: result.decision, principal: input.principal, action: input.action, resource: input.resource, cedar_policy_id: result.reasons.join(',') }, 'authz decision');
      return result;
    });
  };
}
