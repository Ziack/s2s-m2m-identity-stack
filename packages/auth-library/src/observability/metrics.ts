import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export interface Metrics {
  registry: Registry;
  tokenAcquireDuration: Histogram<'client_id' | 'cache_hit'>;
  dpopSignDuration: Histogram<'algorithm'>;
  dpopVerifyDuration: Histogram<'result'>;
  avpDecisionDuration: Histogram<'result' | 'mode'>;
  tokenCacheHitRatio: Gauge<'cache_level'>;
  nonceReplayTotal: Counter<'client_id'>;
  authFailureTotal: Counter<'step' | 'error_code'>;
  circuitState: Gauge<'component' | 'state'>;
  m2mShadowModeDecisionsTotal: Counter<'decision' | 'result'>;
}

function build(): Metrics {
  const registry = new Registry();
  const tokenAcquireDuration = new Histogram({
    name: 'm2m_token_acquire_duration_seconds',
    help: 'Token acquisition latency',
    labelNames: ['client_id', 'cache_hit'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
    registers: [registry],
  });
  const dpopSignDuration = new Histogram({
    name: 'm2m_dpop_sign_duration_seconds',
    help: 'DPoP proof signing latency',
    labelNames: ['algorithm'],
    buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.05],
    registers: [registry],
  });
  const dpopVerifyDuration = new Histogram({
    name: 'm2m_dpop_verify_duration_seconds',
    help: 'DPoP proof verification latency',
    labelNames: ['result'],
    buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.05],
    registers: [registry],
  });
  const avpDecisionDuration = new Histogram({
    name: 'm2m_avp_decision_duration_seconds',
    help: 'AVP authorization decision latency',
    labelNames: ['result', 'mode'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
    registers: [registry],
  });
  const tokenCacheHitRatio = new Gauge({
    name: 'm2m_token_cache_hit_ratio',
    help: 'Token cache hit ratio',
    labelNames: ['cache_level'],
    registers: [registry],
  });
  const nonceReplayTotal = new Counter({
    name: 'm2m_nonce_replay_total',
    help: 'Replay of DPoP nonces detected',
    labelNames: ['client_id'],
    registers: [registry],
  });
  const authFailureTotal = new Counter({
    name: 'm2m_auth_failure_total',
    help: 'Authentication failures by step and code',
    labelNames: ['step', 'error_code'],
    registers: [registry],
  });
  const circuitState = new Gauge({
    name: 'm2m_circuit_cognito_state',
    help: 'Circuit breaker state by component (1 if active for the given state label)',
    labelNames: ['component', 'state'],
    registers: [registry],
  });
  const m2mShadowModeDecisionsTotal = new Counter({
    name: 'm2m_shadow_mode_decisions_total',
    help: 'Total broker-auth middleware decisions emitted while in shadow (log-only) mode',
    labelNames: ['decision', 'result'] as const,
    registers: [registry],
  });
  return {
    registry,
    tokenAcquireDuration,
    dpopSignDuration,
    dpopVerifyDuration,
    avpDecisionDuration,
    tokenCacheHitRatio,
    nonceReplayTotal,
    authFailureTotal,
    circuitState,
    m2mShadowModeDecisionsTotal,
  };
}

let _m: Metrics = build();
export const metrics: Metrics = new Proxy({} as Metrics, {
  get: (_t, p: keyof Metrics) => _m[p],
});

export function resetMetricsForTest(): void {
  _m = build();
}
