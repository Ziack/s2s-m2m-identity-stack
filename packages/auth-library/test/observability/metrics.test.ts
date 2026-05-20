import { describe, it, expect, beforeEach } from 'vitest';
import { metrics, resetMetricsForTest } from '../../src/observability/metrics.js';

describe('metrics registry', () => {
  beforeEach(() => resetMetricsForTest());

  it('exposes the required Prometheus metrics', async () => {
    metrics.tokenAcquireDuration.observe({ client_id: 'c1', cache_hit: 'true' }, 0.001);
    metrics.dpopSignDuration.observe({ algorithm: 'ES256' }, 0.002);
    metrics.dpopVerifyDuration.observe({ result: 'ok' }, 0.003);
    metrics.avpDecisionDuration.observe({ result: 'allow', mode: 'api' }, 0.01);
    metrics.tokenCacheHitRatio.set({ cache_level: 'l1' }, 0.97);
    metrics.nonceReplayTotal.inc({ client_id: 'c1' });
    metrics.authFailureTotal.inc({ step: 'verifyDPoP', error_code: 'dpop_nonce_reuse' });
    metrics.circuitState.set({ component: 'cognito', state: 'closed' }, 1);

    const text = await metrics.registry.metrics();
    expect(text).toContain('m2m_token_acquire_duration_seconds');
    expect(text).toContain('m2m_dpop_sign_duration_seconds');
    expect(text).toContain('m2m_dpop_verify_duration_seconds');
    expect(text).toContain('m2m_avp_decision_duration_seconds');
    expect(text).toContain('m2m_token_cache_hit_ratio');
    expect(text).toContain('m2m_nonce_replay_total');
    expect(text).toContain('m2m_auth_failure_total');
    expect(text).toContain('m2m_circuit_cognito_state');
  });
});
