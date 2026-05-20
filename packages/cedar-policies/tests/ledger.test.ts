import { describe, it, expect } from 'vitest';
import { authorize, ctx, USER_ALICE, USER_BOB, USER_CAROL } from './_helpers.js';

const RECV_OUT = 'M2M::ServicePrincipal::"receiving-service-outbound"';
const LENDING = 'M2M::ServicePrincipal::"lending-service-client-id"';
const AUDIT = 'M2M::ServicePrincipal::"audit-service"';
const LEDGER_RG = 'M2M::ResourceGroup::"ledger-resources"';

const CHAIN_OK = ['calling-service', 'receiving-service-outbound'];

describe('ledger policies', () => {
  it('ALLOWS receiving-service-outbound POST_ledger_entry with ledger/write + dpop_confirmed + loan-officer user', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({
        scopes: ['ledger/write'],
        source_domain: 'ledger',
        user: USER_ALICE,
        actor_chain: CHAIN_OK,
      }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES receiving-service-outbound POST_ledger_entry without dpop_confirmed', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({
        scopes: ['ledger/write'],
        dpop_confirmed: false,
        user: USER_ALICE,
        actor_chain: CHAIN_OK,
      }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES receiving-service-outbound POST_ledger_entry without ledger/write scope', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({
        scopes: ['ledger/read'],
        user: USER_ALICE,
        actor_chain: CHAIN_OK,
      }),
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

// Phase 5: user-role matrix for ledger write + audit read.
describe('ledger POST_ledger_entry with user context (Phase 5)', () => {
  it('ALLOWS receiving-service-outbound + alice (loan-officer) with calling-service in actor_chain', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({
        scopes: ['ledger/write'],
        source_domain: 'ledger',
        user: USER_ALICE,
        actor_chain: CHAIN_OK,
      }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES receiving-service-outbound + bob (auditor only) — forbid via no loan-officer role', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({
        scopes: ['ledger/write'],
        source_domain: 'ledger',
        user: USER_BOB,
        actor_chain: CHAIN_OK,
      }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES receiving-service-outbound + carol (reader only)', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({
        scopes: ['ledger/write'],
        source_domain: 'ledger',
        user: USER_CAROL,
        actor_chain: CHAIN_OK,
      }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES receiving-service-outbound + alice when actor_chain is missing calling-service', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({
        scopes: ['ledger/write'],
        source_domain: 'ledger',
        user: USER_ALICE,
        actor_chain: ['receiving-service-outbound'],
      }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES POST_ledger_entry when user context omitted entirely', () => {
    const r = authorize({
      principal: RECV_OUT,
      action: 'M2M::Action::"POST_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({ scopes: ['ledger/write'], source_domain: 'ledger' }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('ALLOWS audit-service GET_ledger_entry for bob (auditor)', () => {
    const r = authorize({
      principal: AUDIT,
      action: 'M2M::Action::"GET_ledger_entry"',
      resource: LEDGER_RG,
      context: ctx({
        scopes: ['ledger/read'],
        source_domain: 'audit',
        user: USER_BOB,
      }),
    });
    expect(r.decision).toBe('Allow');
  });
});
