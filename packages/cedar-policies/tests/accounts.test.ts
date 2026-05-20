import { describe, it, expect } from 'vitest';
import { authorize, ctx } from './_helpers.js';

const ACC = 'M2M::ServicePrincipal::"accounts-service-client-id"';
const ACC_RG = 'M2M::ResourceGroup::"accounts-resources"';
const CLOSED = 'M2M::ResourceGroup::"accounts-closed"';

describe('accounts policies', () => {
  it('ALLOWS accounts-service GET_account with accounts/read + dpop', () => {
    const r = authorize({
      principal: ACC,
      action: 'M2M::Action::"GET_account"',
      resource: ACC_RG,
      context: ctx({ scopes: ['accounts/read'], source_domain: 'accounts' }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES GET_account when dpop_confirmed=false', () => {
    const r = authorize({
      principal: ACC,
      action: 'M2M::Action::"GET_account"',
      resource: ACC_RG,
      context: ctx({ scopes: ['accounts/read'], source_domain: 'accounts', dpop_confirmed: false }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES POST_account with wrong scope', () => {
    const r = authorize({
      principal: ACC,
      action: 'M2M::Action::"POST_account"',
      resource: ACC_RG,
      context: ctx({ scopes: ['accounts/read'], source_domain: 'accounts' }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('FORBIDS POSTing to closed accounts', () => {
    const r = authorize({
      principal: ACC,
      action: 'M2M::Action::"POST_account"',
      resource: CLOSED,
      context: ctx({ scopes: ['accounts/write'], source_domain: 'accounts' }),
    });
    expect(r.decision).toBe('Deny');
  });
});
