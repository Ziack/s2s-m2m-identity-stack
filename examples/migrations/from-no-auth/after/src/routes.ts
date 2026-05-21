import { Router, type Request } from 'express';

interface AuthDecision {
  decision: 'allow' | 'deny';
  actorChain?: string[];
}

function auth(req: Request): AuthDecision | undefined {
  return (req as Request & { auth?: AuthDecision }).auth;
}

export const internalRouter = Router();

internalRouter.get('/internal/status', (req, res) => {
  if (auth(req)?.decision !== 'allow') return res.status(403).end();
  res.json({ status: 'ok', uptime: process.uptime() });
});

internalRouter.post('/internal/refresh-cache', (req, res) => {
  if (auth(req)?.decision !== 'allow') return res.status(403).end();
  res.json({ refreshed: true });
});
