import { Router } from 'express';
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

export interface BrokerMetrics {
  registry: Registry;
  exchangeDuration: Histogram<'outcome' | 'reentry'>;
  exchangeOutcomeTotal: Counter<'outcome' | 'error_code'>;
  jtiReplayTotal: Counter<'actor'>;
}

let _metrics: BrokerMetrics | null = null;

export function buildBrokerMetrics(): BrokerMetrics {
  if (_metrics) return _metrics;
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const exchangeDuration = new Histogram({
    name: 'broker_exchange_duration_seconds',
    help: 'Token-exchange request duration',
    labelNames: ['outcome', 'reentry'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
    registers: [registry],
  });
  const exchangeOutcomeTotal = new Counter({
    name: 'broker_exchange_outcome_total',
    help: 'Token-exchange outcomes',
    labelNames: ['outcome', 'error_code'],
    registers: [registry],
  });
  const jtiReplayTotal = new Counter({
    name: 'broker_jti_replay_total',
    help: 'Replayed/jti-conflict exchanged-token issuance attempts',
    labelNames: ['actor'],
    registers: [registry],
  });
  _metrics = { registry, exchangeDuration, exchangeOutcomeTotal, jtiReplayTotal };
  return _metrics;
}

export function resetBrokerMetricsForTest(): void {
  _metrics = null;
}

export function metricsRouter(metrics: BrokerMetrics): Router {
  const router = Router();
  router.get('/metrics', async (_req, res) => {
    res.setHeader('content-type', metrics.registry.contentType);
    res.status(200).send(await metrics.registry.metrics());
  });
  return router;
}
