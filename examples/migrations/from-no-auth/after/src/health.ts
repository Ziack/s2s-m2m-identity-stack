import { Router } from 'express';
import client from 'prom-client';

client.collectDefaultMetrics();

export const healthRouter = Router();
healthRouter.get('/health', (_req, res) => res.json({ status: 'ok' }));
healthRouter.get('/metrics', async (_req, res) => {
  res.type(client.register.contentType);
  res.send(await client.register.metrics());
});
