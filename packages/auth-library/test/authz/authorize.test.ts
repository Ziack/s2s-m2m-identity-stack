import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthorize } from '../../src/authz/authorize.js';
import { createCedarLocal } from '../../src/authz/cedarLocal.js';

describe('authorize', () => {
  let now = 1_700_000_000_000;
  beforeEach(() => { now = 1_700_000_000_000; });

  it('uses AVP and caches decisions for 30s', async () => {
    let calls = 0;
    const fakeAvp = {
      isAuthorizedWithToken: async () => { calls++; return { Decision: 'ALLOW', DeterminingPolicies: [{ PolicyId: 'pol-1' }] }; },
    };
    const authorize = createAuthorize({
      mode: 'avp_api',
      policyStoreId: 'ps-1',
      avpClient: fakeAvp as never,
      cedarLocal: createCedarLocal([]),
      nowFn: () => now,
      cacheTtlMs: 30_000,
    });
    const a = await authorize({ principal: 'p', action: 'a', resource: 'r', token: 'tok' });
    const b = await authorize({ principal: 'p', action: 'a', resource: 'r', token: 'tok' });
    expect(a.decision).toBe('ALLOW');
    expect(b.mode).toBe('cache');
    expect(calls).toBe(1);
    now += 31_000;
    await authorize({ principal: 'p', action: 'a', resource: 'r', token: 'tok' });
    expect(calls).toBe(2);
  });

  it('falls back to local Cedar when AVP throws and local engine configured', async () => {
    const fakeAvp = { isAuthorizedWithToken: async () => { throw new Error('avp down'); } };
    const local = createCedarLocal([{ id: 'p1', effect: 'permit', principal: 'p', action: 'a', resource: 'r' }]);
    const authorize = createAuthorize({
      mode: 'avp_api',
      policyStoreId: 'ps-1',
      avpClient: fakeAvp as never,
      cedarLocal: local,
      nowFn: () => now,
      cacheTtlMs: 30_000,
      fallbackToLocal: true,
    });
    const r = await authorize({ principal: 'p', action: 'a', resource: 'r', token: 'tok' });
    expect(r.decision).toBe('ALLOW');
    expect(r.mode).toBe('local');
  });
});

describe('createAuthorize — entity mode + STRICT encoding', () => {
  it('splits a namespaced action at the LAST :: (M2M::Action::POST_loan_application)', async () => {
    const calls: any[] = [];
    const avpClient = {
      async isAuthorizedWithToken(input: any) { calls.push(input); return { Decision: 'ALLOW' as const, DeterminingPolicies: [] }; },
    } as any;
    const authorize = (await import('../../src/authz/authorize.js')).createAuthorize({
      mode: 'avp_api', policyStoreId: 'ps', avpClient, cedarLocal: { evaluate: () => ({ decision: 'DENY', reasons: [], evaluationTimeMs: 0, mode: 'local' }) } as any,
    });
    await authorize({
      principal: 'M2M::ServicePrincipal::svc', action: 'M2M::Action::POST_loan_application',
      resource: 'M2M::ResourceGroup::lending-resources', token: 't',
      context: { dpop_confirmed: true, scopes: ['lending/write'], source_domain: 'lending', correlation_id: 'c1' },
    });
    expect(calls[0].Action).toEqual({ ActionType: 'M2M::Action', ActionId: 'POST_loan_application' });
    expect(calls[0].Resource).toEqual({ EntityType: 'M2M::ResourceGroup', EntityId: 'lending-resources' });
  });

  it('encodes the AVP context map as typed AttributeValues', async () => {
    let captured: any;
    const avpClient = {
      async isAuthorizedWithToken(input: any) { captured = input; return { Decision: 'ALLOW' as const, DeterminingPolicies: [] }; },
    } as any;
    const authorize = (await import('../../src/authz/authorize.js')).createAuthorize({
      mode: 'avp_api', policyStoreId: 'ps', avpClient, cedarLocal: { evaluate: () => ({ decision: 'DENY', reasons: [], evaluationTimeMs: 0, mode: 'local' }) } as any,
    });
    await authorize({
      principal: 'M2M::ServicePrincipal::svc', action: 'M2M::Action::POST_loan_application',
      resource: 'M2M::ResourceGroup::lending-resources', token: 't',
      context: { dpop_confirmed: true, scopes: ['lending/write'], source_domain: 'lending', correlation_id: 'c1' },
    });
    expect(captured.Context.ContextMap.dpop_confirmed).toEqual({ boolean: true });
    expect(captured.Context.ContextMap.scopes).toEqual({ set: [{ string: 'lending/write' }] });
  });

  it("avpApi:'entity' calls isAuthorized with an explicit principal entity and no token", async () => {
    let captured: any;
    const avpClient = {
      async isAuthorized(input: any) { captured = input; return { Decision: 'ALLOW' as const, DeterminingPolicies: [{ PolicyId: 'p9' }] }; },
    } as any;
    const authorize = (await import('../../src/authz/authorize.js')).createAuthorize({
      mode: 'avp_api', avpApi: 'entity', policyStoreId: 'ps', avpClient, cedarLocal: { evaluate: () => ({ decision: 'DENY', reasons: [], evaluationTimeMs: 0, mode: 'local' }) } as any,
    });
    const res = await authorize({
      principal: 'M2M::ServicePrincipal::calling-service', action: 'M2M::Action::POST_loan_application',
      resource: 'M2M::ResourceGroup::lending-resources', token: '',
      context: { dpop_confirmed: false, scopes: ['lending/write'], source_domain: 'lending', correlation_id: 'c1', user: { sub: 'u1', roles: ['loan-officer'], groups: [] } },
    });
    expect(captured.Principal).toEqual({ EntityType: 'M2M::ServicePrincipal', EntityId: 'calling-service' });
    expect(captured.Action).toEqual({ ActionType: 'M2M::Action', ActionId: 'POST_loan_application' });
    expect(captured.Context.ContextMap.user).toEqual({ record: { sub: { string: 'u1' }, roles: { set: [{ string: 'loan-officer' }] }, groups: { set: [] } } });
    expect(res.decision).toBe('ALLOW');
    expect(res.reasons).toEqual(['p9']);
  });
});

describe('createAuthorize — decision cache keys on context', () => {
  it('does NOT share a cached decision across differing context.user.roles', async () => {
    let calls = 0;
    const avpClient = {
      async isAuthorized(input: any) {
        calls++;
        const roles = (input.Context?.ContextMap?.user?.record?.roles?.set ?? []) as Array<{ string: string }>;
        const isOfficer = roles.some((r) => r.string === 'loan-officer');
        return { Decision: (isOfficer ? 'ALLOW' : 'DENY') as 'ALLOW' | 'DENY', DeterminingPolicies: [] };
      },
    } as any;
    const authorize = createAuthorize({
      mode: 'avp_api', avpApi: 'entity', policyStoreId: 'ps',
      avpClient, cedarLocal: createCedarLocal([]), cacheTtlMs: 30_000,
    });
    const base = {
      principal: 'M2M::ServicePrincipal::calling-service',
      action: 'M2M::Action::POST_loan_application',
      resource: 'M2M::ResourceGroup::lending-resources',
      token: '',
    };
    // Same principal/action/resource, different user — must NOT share a cache entry.
    const r1 = await authorize({ ...base, context: { dpop_confirmed: true, scopes: ['lending/write'], source_domain: 'lending', correlation_id: 'c1', user: { sub: 'u1', roles: ['loan-officer'], groups: [] } } });
    const r2 = await authorize({ ...base, context: { dpop_confirmed: true, scopes: ['lending/write'], source_domain: 'lending', correlation_id: 'c1', user: { sub: 'u2', roles: ['reader'], groups: [] } } });
    expect(r1.decision).toBe('ALLOW');
    expect(r2.decision).toBe('DENY');
    expect(calls).toBe(2);
  });

  it('still serves a cache hit when context is identical (regardless of key order)', async () => {
    let calls = 0;
    const avpClient = {
      async isAuthorized() { calls++; return { Decision: 'ALLOW' as const, DeterminingPolicies: [] }; },
    } as any;
    const authorize = createAuthorize({
      mode: 'avp_api', avpApi: 'entity', policyStoreId: 'ps',
      avpClient, cedarLocal: createCedarLocal([]), cacheTtlMs: 30_000,
    });
    const base = {
      principal: 'M2M::ServicePrincipal::calling-service',
      action: 'M2M::Action::POST_loan_application',
      resource: 'M2M::ResourceGroup::lending-resources',
      token: '',
    };
    const a = await authorize({ ...base, context: { dpop_confirmed: true, scopes: ['lending/write'], source_domain: 'lending', correlation_id: 'c1' } });
    // Same logical context, different key insertion order — canonicalization must hash identically.
    const b = await authorize({ ...base, context: { correlation_id: 'c1', source_domain: 'lending', scopes: ['lending/write'], dpop_confirmed: true } });
    expect(a.decision).toBe('ALLOW');
    expect(b.mode).toBe('cache');
    expect(calls).toBe(1);
  });
});
