import { Router, type Request } from 'express';

interface AuthDecision {
  decision: 'allow' | 'deny';
  principal?: string;
  actorChain?: string[];
}

function auth(req: Request): AuthDecision | undefined {
  return (req as Request & { auth?: AuthDecision }).auth;
}

export const reportsRouter = Router();

reportsRouter.get('/reports', (req, res) => {
  if (auth(req)?.decision !== 'allow') return res.status(403).end();
  res.json({ reports: [{ id: 'r-1' }] });
});

reportsRouter.post('/reports', (req, res) => {
  if (auth(req)?.decision !== 'allow') return res.status(403).end();
  res.status(201).json({ id: 'r-2' });
});

reportsRouter.delete('/reports/:id', (req, res) => {
  if (auth(req)?.decision !== 'allow') return res.status(403).end();
  res.status(204).end();
});
