import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { buildAuthMiddleware } from '../lib/buildAuthMiddleware.js';
import type { LedgerServiceConfig } from '../config.js';

interface LedgerEntry {
  entryId: string;
  status: 'posted' | 'pending';
  amount: number;
  reference: string;
  createdBy: string;
  createdAt: string;
}

const store: LedgerEntry[] = [];

type AuthedRequest = Request & {
  auth?: {
    sub?: string;
    scopes?: string[];
    decision?: 'ALLOW' | 'DENY';
    reasons?: string[];
    principal?: string;
    action?: string;
  };
};

export function entriesRouter(config: LedgerServiceConfig): Router {
  const router = Router();
  const auth = buildAuthMiddleware(config);

  router.post('/ledger/entries', auth, (req: AuthedRequest, res: Response) => {
    const principal = req.auth?.sub ?? req.auth?.principal ?? 'unknown';
    const entry: LedgerEntry = {
      entryId: `E-${randomUUID().slice(0, 8)}`,
      status: 'posted',
      amount: Number(req.body?.amount ?? 0),
      reference: String(req.body?.reference ?? ''),
      createdBy: principal,
      createdAt: new Date().toISOString(),
    };
    store.push(entry);
    res.status(201).json({ entryId: entry.entryId, status: entry.status });
  });

  router.get('/ledger/entries', auth, (_req: Request, res: Response) => {
    res.status(200).json(store);
  });

  return router;
}
