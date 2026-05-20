import { describe, it, expect } from 'vitest';
import { authorize, ctx } from './_helpers.js';

const NOTI = 'M2M::ServicePrincipal::"notifications-service-client-id"';
const NOTI_RG = 'M2M::ResourceGroup::"notifications-resources"';
const MARKETING = 'M2M::ResourceGroup::"notifications-marketing"';

describe('notifications policies', () => {
  it('ALLOWS notifications-service POST_notification with notifications/write + dpop', () => {
    const r = authorize({
      principal: NOTI,
      action: 'M2M::Action::"POST_notification"',
      resource: NOTI_RG,
      context: ctx({ scopes: ['notifications/write'], source_domain: 'notifications' }),
    });
    expect(r.decision).toBe('Allow');
  });

  it('DENIES POST_notification when dpop_confirmed=false', () => {
    const r = authorize({
      principal: NOTI,
      action: 'M2M::Action::"POST_notification"',
      resource: NOTI_RG,
      context: ctx({ scopes: ['notifications/write'], source_domain: 'notifications', dpop_confirmed: false }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('DENIES POST_notification with wrong scope', () => {
    const r = authorize({
      principal: NOTI,
      action: 'M2M::Action::"POST_notification"',
      resource: NOTI_RG,
      context: ctx({ scopes: ['notifications/read'], source_domain: 'notifications' }),
    });
    expect(r.decision).toBe('Deny');
  });

  it('FORBIDS marketing notifications without notifications/marketing scope', () => {
    const r = authorize({
      principal: NOTI,
      action: 'M2M::Action::"POST_notification"',
      resource: MARKETING,
      context: ctx({ scopes: ['notifications/write'], source_domain: 'notifications' }),
    });
    expect(r.decision).toBe('Deny');
  });
});
