import { Router } from 'express';

export const internalRouter = Router();

internalRouter.get('/internal/status', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

internalRouter.post('/internal/refresh-cache', (_req, res) => {
  res.json({ refreshed: true });
});
