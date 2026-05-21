import { describe, it, expect, beforeEach } from 'vitest';
import { metrics, resetMetricsForTest } from '../../src/observability/metrics.js';

describe('metrics.m2mShadowModeDecisionsTotal', () => {
  beforeEach(() => resetMetricsForTest());

  it('is registered with decision + result labels and increments cleanly', async () => {
    metrics.m2mShadowModeDecisionsTotal.inc({ decision: 'ALLOW', result: 'would_allow' });
    metrics.m2mShadowModeDecisionsTotal.inc({ decision: 'DENY', result: 'would_deny' });
    metrics.m2mShadowModeDecisionsTotal.inc({ decision: 'INVALID', result: 'invalid_token' });
    const dump = await metrics.registry.metrics();
    expect(dump).toContain('m2m_shadow_mode_decisions_total');
    expect(dump).toContain('decision="ALLOW"');
    expect(dump).toContain('result="would_allow"');
    expect(dump).toContain('decision="INVALID"');
  });
});
