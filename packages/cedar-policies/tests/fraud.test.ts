import { describe, it, expect } from 'vitest';
import { authorize, ctx } from './_helpers.js';

const FRAUD = 'M2M::ServicePrincipal::"fraud-service-client-id"';
const FRAUD_RG = 'M2M::ResourceGroup::"fraud-resources"';
const CLOSED = 'M2M::ResourceGroup::"fraud-cases-closed"';

describe('fraud policies', () => {
  it('ALLOWS fraud-service POST_fraud_signal with fraud/write + dpop', () => {
    const r = authorize({
      principal: FRAUD,
      action: 'M2M::Action::"POST_fraud_signal"',
      resource: FRAUD_RG,
      context: ctx({ scopes: ['fraud/write'], source_domain: 'fraud' }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES POST_fraud_signal when dpop_confirmed=false', () => {
    const r = authorize({
      principal: FRAUD,
      action: 'M2M::Action::"POST_fraud_signal"',
      resource: FRAUD_RG,
      context: ctx({ scopes: ['fraud/write'], source_domain: 'fraud', dpop_confirmed: false }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES POST_fraud_signal with wrong scope', () => {
    const r = authorize({
      principal: FRAUD,
      action: 'M2M::Action::"POST_fraud_signal"',
      resource: FRAUD_RG,
      context: ctx({ scopes: ['fraud/read'], source_domain: 'fraud' }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('FORBIDS mutating closed fraud cases', () => {
    const r = authorize({
      principal: FRAUD,
      action: 'M2M::Action::"POST_fraud_signal"',
      resource: CLOSED,
      context: ctx({ scopes: ['fraud/write'], source_domain: 'fraud' }),
    });
    expect(r.decision).toBe('Deny');
  });
});
