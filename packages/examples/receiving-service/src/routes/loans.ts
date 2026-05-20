import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { buildAuthMiddleware } from '../lib/buildAuthMiddleware.js';
import type { ReceivingServiceConfig } from '../config.js';

interface Loan { loanId: string; amount: number; applicantId: string; createdBy: string; createdAt: string; }
const store: Loan[] = [];

// SDK middleware (`createAuthMiddleware`) injects `req.auth = { sub, scopes,
// decision, reasons }`. Legacy `principal` / `action` keys were never injected
// by the SDK — we read `sub` directly. The loose shape preserves compatibility
// with test mocks that may still set `principal`.
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

export function loansRouter(config: ReceivingServiceConfig): Router {
  const router = Router();
  const auth = buildAuthMiddleware(config);

  router.post('/loans', auth, (req: AuthedRequest, res: Response) => {
    const principal = req.auth?.sub ?? req.auth?.principal ?? 'unknown';
    const loan: Loan = {
      loanId: `L-${randomUUID().slice(0, 8)}`,
      amount: Number(req.body?.amount ?? 0),
      applicantId: String(req.body?.applicantId ?? ''),
      createdBy: principal,
      createdAt: new Date().toISOString(),
    };
    store.push(loan);
    res.status(201).json(loan);
  });

  router.get('/loans', auth, (_req: Request, res: Response) => res.status(200).json(store));
  return router;
}
