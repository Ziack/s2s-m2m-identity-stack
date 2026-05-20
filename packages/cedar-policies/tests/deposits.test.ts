import { describe, it, expect } from 'vitest';
import { authorize, ctx } from './_helpers.js';

const DEP = 'M2M::ServicePrincipal::"deposits-service-client-id"';
const DEP_RG = 'M2M::ResourceGroup::"deposits-resources"';
const HIGH_VAL = 'M2M::ResourceGroup::"deposits-high-value"';

describe('deposits policies', () => {
  it('ALLOWS deposits-service POST_deposit with deposits/write + dpop', () => {
    const r = authorize({
      principal: DEP,
      action: 'M2M::Action::"POST_deposit"',
      resource: DEP_RG,
      context: ctx({ scopes: ['deposits/write'], source_domain: 'deposits' }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES POST_deposit when dpop_confirmed=false', () => {
    const r = authorize({
      principal: DEP,
      action: 'M2M::Action::"POST_deposit"',
      resource: DEP_RG,
      context: ctx({ scopes: ['deposits/write'], source_domain: 'deposits', dpop_confirmed: false }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES POST_deposit with wrong scope', () => {
    const r = authorize({
      principal: DEP,
      action: 'M2M::Action::"POST_deposit"',
      resource: DEP_RG,
      context: ctx({ scopes: ['deposits/read'], source_domain: 'deposits' }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('FORBIDS deposits-high-value POST without deposits/high-value scope', () => {
    const r = authorize({
      principal: DEP,
      action: 'M2M::Action::"POST_deposit"',
      resource: HIGH_VAL,
      context: ctx({ scopes: ['deposits/write'], source_domain: 'deposits' }),
    });
    expect(r.decision).toBe('Deny');
  });
});
