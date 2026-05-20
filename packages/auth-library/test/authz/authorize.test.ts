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
