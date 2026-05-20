import { describe, it, expect } from 'vitest';
import { authorize, ctx } from './_helpers.js';

const PAY = 'M2M::ServicePrincipal::"payments-service-client-id"';
const PAY_RG = 'M2M::ResourceGroup::"payments-resources"';
const SANCTIONED = 'M2M::ResourceGroup::"payments-sanctioned"';

describe('payments policies', () => {
  it('ALLOWS payments-service POST_payment with payments/write + dpop', () => {
    const r = authorize({
      principal: PAY,
      action: 'M2M::Action::"POST_payment"',
      resource: PAY_RG,
      context: ctx({ scopes: ['payments/write'], source_domain: 'payments' }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES POST_payment when dpop_confirmed=false', () => {
    const r = authorize({
      principal: PAY,
      action: 'M2M::Action::"POST_payment"',
      resource: PAY_RG,
      context: ctx({ scopes: ['payments/write'], source_domain: 'payments', dpop_confirmed: false }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES POST_payment with wrong scope', () => {
    const r = authorize({
      principal: PAY,
      action: 'M2M::Action::"POST_payment"',
      resource: PAY_RG,
      context: ctx({ scopes: ['payments/read'], source_domain: 'payments' }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('FORBIDS payments to sanctioned recipients regardless of scope', () => {
    const r = authorize({
      principal: PAY,
      action: 'M2M::Action::"POST_payment"',
      resource: SANCTIONED,
      context: ctx({ scopes: ['payments/write'], source_domain: 'payments' }),
    });
    expect(r.decision).toBe('Deny');
  });
});
