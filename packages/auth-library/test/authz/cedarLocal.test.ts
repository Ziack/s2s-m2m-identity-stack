import { describe, it, expect } from 'vitest';
import { createCedarLocal, type LocalPolicy } from '../../src/authz/cedarLocal.js';

describe('cedarLocal', () => {
  const policies: LocalPolicy[] = [
    {
      id: 'p-allow-dpop-write',
      effect: 'permit',
      principal: 'ServicePrincipal::lending-svc',
      action: 'POST_loan_application',
      resource: 'ResourceGroup::lending-resources',
      whenScopesInclude: ['lending/write'],
      whenContextEquals: { dpop_confirmed: true },
    },
    {
      id: 'p-forbid-pii',
      effect: 'forbid',
      resource: 'ResourceGroup::pii-resources',
      unlessScopesInclude: ['data-privacy/pii-access'],
    },
  ];

  it('permits when scopes and context match', () => {
    const cedar = createCedarLocal(policies);
    const r = cedar.evaluate({
      principal: 'ServicePrincipal::lending-svc',
      action: 'POST_loan_application',
      resource: 'ResourceGroup::lending-resources',
      context: { dpop_confirmed: true, scopes: ['lending/write'] },
    });
    expect(r.decision).toBe('ALLOW');
    expect(r.reasons).toContain('p-allow-dpop-write');
  });

  it('forbid policies override permits', () => {
    const cedar = createCedarLocal(policies);
    const r = cedar.evaluate({
      principal: 'ServicePrincipal::lending-svc',
      action: 'POST_loan_application',
      resource: 'ResourceGroup::pii-resources',
      context: { dpop_confirmed: true, scopes: ['lending/write'] },
    });
    expect(r.decision).toBe('DENY');
    expect(r.reasons).toContain('p-forbid-pii');
  });

  it('denies by default with no matching permit', () => {
    const cedar = createCedarLocal(policies);
    const r = cedar.evaluate({
      principal: 'ServicePrincipal::other',
      action: 'GET_loan_status',
      resource: 'ResourceGroup::lending-resources',
      context: { scopes: [] },
    });
    expect(r.decision).toBe('DENY');
  });
});
