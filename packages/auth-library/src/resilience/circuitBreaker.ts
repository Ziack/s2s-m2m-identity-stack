import { CircuitState, circuitBreaker, ConsecutiveBreaker, handleAll, type CircuitBreakerPolicy } from 'cockatiel';
import { metrics } from '../observability/metrics.js';

export interface BreakerOptions {
  failureThreshold: number;
  halfOpenAfterMs: number;
  samplingDurationMs: number;
}

export interface NamedBreaker {
  name: string;
  policy: CircuitBreakerPolicy;
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

const _registry = new Map<string, NamedBreaker>();

export function buildBreaker(name: string, opts: BreakerOptions): NamedBreaker {
  const existing = _registry.get(name);
  if (existing) return existing;
  const policy = circuitBreaker(handleAll, {
    halfOpenAfter: opts.halfOpenAfterMs,
    breaker: new ConsecutiveBreaker(opts.failureThreshold),
  });
  policy.onStateChange((state) => {
    // cockatiel's CircuitState is a numeric enum (Closed=0, Open=1, HalfOpen=2,
    // Isolated=3), so stringifying it yields '0'..'3' — pattern-matching on
    // substrings like 'open'/'closed' silently never matches. Compare the
    // numeric enum value directly and set one gauge series to 1, the others to 0.
    const isOpen = state === CircuitState.Open || state === CircuitState.Isolated;
    const isHalfOpen = state === CircuitState.HalfOpen;
    const isClosed = state === CircuitState.Closed;
    metrics.circuitState.set({ component: name, state: 'open' }, isOpen ? 1 : 0);
    metrics.circuitState.set({ component: name, state: 'half_open' }, isHalfOpen ? 1 : 0);
    metrics.circuitState.set({ component: name, state: 'closed' }, isClosed ? 1 : 0);
  });
  const wrapper: NamedBreaker = {
    name,
    policy,
    execute: <T,>(fn: () => Promise<T>) => policy.execute(fn),
  };
  _registry.set(name, wrapper);
  return wrapper;
}

export function resetBreakersForTest(): void {
  _registry.clear();
}
