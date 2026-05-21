import { Router } from 'express';
import { register } from 'prom-client';

export const metricsRouter: Router = Router();

metricsRouter.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});
