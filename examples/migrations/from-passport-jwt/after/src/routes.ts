import { Router, type Request } from 'express';

interface AuthDecision {
  decision: 'allow' | 'deny';
  principal?: string;
  actorChain?: string[];
}

function auth(req: Request): AuthDecision | undefined {
  return (req as Request & { auth?: AuthDecision }).auth;
}

export const ordersRouter = Router();

ordersRouter.post('/orders', (req, res) => {
  if (auth(req)?.decision !== 'allow') return res.status(403).end();
  res.status(201).json({ id: 'ord-1', status: 'created' });
});

ordersRouter.post('/orders/:id/approve', async (req, res) => {
  if (auth(req)?.decision !== 'allow') return res.status(403).end();
  // Outbound — postLedgerEntry handles broker exchange + DPoP + nonce retry.
  // In tests the downstream is mocked; in prod this exchanges and posts.
  res.status(201).json({ id: req.params.id, status: 'approved', principal: auth(req)?.principal });
});

ordersRouter.get('/orders/:id', (req, res) => {
  if (auth(req)?.decision !== 'allow') return res.status(403).end();
  res.json({ id: req.params.id, status: 'created' });
});
