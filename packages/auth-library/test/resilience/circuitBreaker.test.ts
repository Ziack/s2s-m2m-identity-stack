import { describe, it, expect, beforeEach } from 'vitest';
import { buildBreaker, resetBreakersForTest } from '../../src/resilience/circuitBreaker.js';
import { metrics, resetMetricsForTest } from '../../src/observability/metrics.js';

describe('circuit breaker', () => {
  beforeEach(() => {
    resetBreakersForTest();
    resetMetricsForTest();
  });

  it('opens after 5 consecutive failures and rejects subsequent calls', async () => {
    const breaker = buildBreaker('test-cmp', { failureThreshold: 5, halfOpenAfterMs: 30_000, samplingDurationMs: 60_000 });
    let calls = 0;
    const failing = async (): Promise<void> => { calls++; throw new Error('boom'); };
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('boom');
    }
    expect(calls).toBe(5);
    await expect(breaker.execute(failing)).rejects.toThrow();
    expect(calls).toBe(5);
  });

  it('exposes a component name', () => {
    const b = buildBreaker('cognito', { failureThreshold: 5, halfOpenAfterMs: 30_000, samplingDurationMs: 60_000 });
    expect(b.name).toBe('cognito');
  });

  it('sets circuitState gauge to 1 for the active state and 0 for others on transition', async () => {
    const breaker = buildBreaker('cognito', { failureThreshold: 5, halfOpenAfterMs: 30_000, samplingDurationMs: 60_000 });
    const failing = async (): Promise<void> => { throw new Error('boom'); };
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow();
    }
    const values = (await metrics.circuitState.get()).values;
    const byState = (state: string): number | undefined =>
      values.find((v) => v.labels.component === 'cognito' && v.labels.state === state)?.value;
    expect(byState('open')).toBe(1);
    expect(byState('closed')).toBe(0);
    expect(byState('half_open')).toBe(0);
  });
});
