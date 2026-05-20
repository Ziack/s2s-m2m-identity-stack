import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { buildAuthMiddleware } from '../lib/buildAuthMiddleware.js';
import { postLedgerEntry, LedgerOutboundError } from '../lib/ledgerClient.js';
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

  router.post('/loans', auth, async (req: AuthedRequest, res: Response) => {
    const principal = req.auth?.sub ?? req.auth?.principal ?? 'unknown';
    const loan: Loan = {
      loanId: `L-${randomUUID().slice(0, 8)}`,
      amount: Number(req.body?.amount ?? 0),
      applicantId: String(req.body?.applicantId ?? ''),
      createdBy: principal,
      createdAt: new Date().toISOString(),
    };
    store.push(loan);

    if (config.ledgerOutboundEnabled) {
      const correlationId =
        req.header('x-correlation-id') ?? req.header('x-request-id') ?? randomUUID();
      const reqLog = (req as Request & { log?: { error: (...a: unknown[]) => void; info: (...a: unknown[]) => void } }).log;
      try {
        const ledger = await postLedgerEntry(config, {
          correlationId,
          payload: { loanId: loan.loanId, amount: loan.amount },
        });
        reqLog?.info(
          { event: 'ledger.outbound.success', correlation_id: correlationId, loan_id: loan.loanId, entry_id: ledger.entryId },
          'ledger.outbound.success',
        );
        res.status(201).json({ ...loan, ledger: { entryId: ledger.entryId, status: ledger.status } });
        return;
      } catch (err) {
        reqLog?.error(
          { err, event: 'ledger.outbound.failure', correlation_id: correlationId, loan_id: loan.loanId },
          'ledger.outbound.failure',
        );
        const status = err instanceof LedgerOutboundError ? 502 : 502;
        res.status(status).json({
          error: 'downstream_unavailable',
          error_description: err instanceof Error ? err.message : 'ledger outbound failed',
          request_id: correlationId,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    res.status(201).json(loan);
  });

  router.get('/loans', auth, (_req: Request, res: Response) => res.status(200).json(store));
  return router;
}
