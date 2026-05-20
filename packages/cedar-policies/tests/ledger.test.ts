import { describe, it, expect } from 'vitest';
import { authorize, ctx } from './_helpers.js';

const RECV_OUT = 'M2M::ServicePrincipal::"receiving-service-outbound"';
const LENDING = 'M2M::ServicePrincipal::"lending-service-client-id"';
const AUDIT = 'M2M::ServicePrincipal::"audit-service"';
const LEDGER_RG = 'M2M::ResourceGroup::"ledger-resources"';

describe('ledger policies', () => {
  it('ALLOWS receiving-service-outbound POST_ledger_entry with ledger/write + dpop_confirmed', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({ scopes: ['ledger/write'], source_domain: 'ledger' }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES receiving-service-outbound POST_ledger_entry without dpop_confirmed', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({ scopes: ['ledger/write'], dpop_confirmed: false }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES receiving-service-outbound POST_ledger_entry without ledger/write scope', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({ scopes: ['ledger/read'] }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES lending-service from POST_ledger_entry (cross-context isolation)', () => {
    const r = authorize({
      principal: LENDING,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({ scopes: ['ledger/write', 'lending/write'], source_domain: 'lending' }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('ALLOWS audit-service GET_ledger_entry with ledger/read + dpop', () => {
    const r = authorize({
      principal: AUDIT,
      action: 'M2M::Action::"GET_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({ scopes: ['ledger/read'], source_domain: 'audit' }),
    });
    expect(r.decision).toBe('Allow');
  });
});
