import { Router } from 'express';

export const healthRouter: Router = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

healthRouter.get('/health/auth', (_req, res) => {
  // Deep-health: SDK helpers may be wired here in future versions.
  res.status(200).json({ status: 'ok', auth: 'ready' });
});
