import { Router } from 'express';
import { requireJwt, requireRole } from './auth.js';
import { postLedgerEntry } from './downstream.js';

export const ordersRouter = Router();

ordersRouter.post('/orders', requireJwt, (req, res) => {
  res.status(201).json({ id: 'ord-1', status: 'created' });
});

ordersRouter.post(
  '/orders/:id/approve',
  requireJwt,
  requireRole('manager'),
  async (req, res) => {
    const ledgerResp = await postLedgerEntry(req, {
      orderId: req.params.id,
      action: 'approve',
    });
    res.status(ledgerResp.ok ? 201 : 502).json({ id: req.params.id, status: 'approved' });
  },
);

ordersRouter.get('/orders/:id', requireJwt, (req, res) => {
  res.json({ id: req.params.id, status: 'created' });
});
