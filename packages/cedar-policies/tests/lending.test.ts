import { describe, it, expect } from 'vitest';
import { authorize, ctx } from './_helpers.js';

const LENDING = 'M2M::ServicePrincipal::"lending-service-client-id"';
const BATCH = 'M2M::ServicePrincipal::"batch-processor-client-id"';
const LENDING_RG = 'M2M::ResourceGroup::"lending-resources"';
const REPORT_RG = 'M2M::ResourceGroup::"reporting-resources"';

describe('lending policies', () => {
  it('ALLOWS lending-service to POST_loan_application with lending/write + dpop', () => {
    const r = authorize({
      principal: LENDING,
      action: 'M2M::Action::"POST_loan_application"',
      resource: LENDING_RG,
      context: ctx({ scopes: ['lending/write'], source_domain: 'lending' }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES POST_loan_application when dpop_confirmed=false', () => {
    const r = authorize({
      principal: LENDING,
      action: 'M2M::Action::"POST_loan_application"',
      resource: LENDING_RG,
      context: ctx({ scopes: ['lending/write'], dpop_confirmed: false }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES POST_loan_application when scope is wrong', () => {
    const r = authorize({
      principal: LENDING,
      action: 'M2M::Action::"POST_loan_application"',
      resource: LENDING_RG,
      context: ctx({ scopes: ['lending/read'] }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('ALLOWS batch processor GET_loan_status at hour=3 from batch domain', () => {
    const r = authorize({
      principal: BATCH,
      action: 'M2M::Action::"GET_loan_status"',
      resource: REPORT_RG,
      context: ctx({
        scopes: ['lending/read'],
        source_domain: 'batch',
        request_hour: 3,
      }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES batch processor GET_loan_status at hour=10', () => {
    const r = authorize({
      principal: BATCH,
      action: 'M2M::Action::"GET_loan_status"',
      resource: REPORT_RG,
      context: ctx({
        scopes: ['lending/read'],
        source_domain: 'batch',
        request_hour: 10,
      }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES lending principal from POSTing a deposit (cross-context isolation)', () => {
    const r = authorize({
      principal: LENDING,
      action: 'M2M::Action::"POST_deposit"',
      resource: 'M2M::ResourceGroup::"deposits-resources"',
      context: ctx({ scopes: ['lending/write'], source_domain: 'lending' }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES POST_loan_application reading pii-resources without pii-access scope', () => {
    const r = authorize({
      principal: LENDING,
      action: 'M2M::Action::"POST_loan_application"',
      resource: 'M2M::ResourceGroup::"pii-resources"',
      context: ctx({ scopes: ['lending/write'] }),
    });
    expect(r.decision).toBe('Deny');
  });
});
