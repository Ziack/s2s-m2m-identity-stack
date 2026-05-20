import { Router } from 'express';
import { register, collectDefaultMetrics } from 'prom-client';

let defaultsCollected = false;

export function metricsRouter(): Router {
  if (!defaultsCollected) {
    collectDefaultMetrics({ register });
    defaultsCollected = true;
  }
  const router = Router();
  router.get('/metrics', async (_req, res) => {
    res.setHeader('content-type', register.contentType);
    res.send(await register.metrics());
  });
  return router;
}
