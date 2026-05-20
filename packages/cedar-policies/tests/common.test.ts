import { describe, it, expect } from 'vitest';
import { authorize, ctx } from './_helpers.js';

describe('common policies', () => {
  it('DENIES any request when dpop_confirmed=false', () => {
    const r = authorize({
      principal: 'M2M::ServicePrincipal::"lending-service-client-id"',
      action: 'M2M::Action::"POST_loan_application"',
      resource: 'M2M::ResourceGroup::"lending-resources"',
      context: ctx({ dpop_confirmed: false }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES access to pii-resources without data-privacy/pii-access scope', () => {
    const r = authorize({
      principal: 'M2M::ServicePrincipal::"lending-service-client-id"',
      action: 'M2M::Action::"GET_loan_status"',
      resource: 'M2M::ResourceGroup::"pii-resources"',
      context: ctx({ scopes: ['lending/read'] }),
      entities: [
        { uid: { type: 'M2M::ServicePrincipal', id: 'lending-service-client-id' }, attrs: { domain: 'lending' }, parents: [] },
        { uid: { type: 'M2M::ResourceGroup', id: 'pii-resources' }, attrs: { domain: 'data-privacy' }, parents: [] },
      ],
    });
    expect(r.decision).toBe('Deny');
  });
});
