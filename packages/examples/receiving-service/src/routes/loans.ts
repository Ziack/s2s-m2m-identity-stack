import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { buildBrokerAuthMiddleware, actorChainAsString } from '../lib/brokerAuthMiddleware.js';
import { postLedgerEntry, LedgerOutboundError } from '../lib/ledgerClient.js';
import type { ReceivingServiceConfig } from '../config.js';
import type { UserContext, ActorChain } from '@s2s/auth-library';

interface Loan { loanId: string; amount: number; applicantId: string; createdBy: string; createdAt: string; }
const store: Loan[] = [];

// Broker-aware middleware (`createBrokerAuthMiddleware`) populates
// `req.auth = { sub, scopes, decision, reasons, user, actor_chain, token }`.
// The loose shape below tolerates older test mocks that set `principal`.
type AuthedRequest = Request & {
  auth?: {
    sub?: string;
    scopes?: string[];
    decision?: 'ALLOW' | 'DENY';
    reasons?: string[];
    principal?: string;
    action?: string;
    user?: UserContext;
    actor_chain?: ActorChain | null;
    token?: string;
  };
};

export function loansRouter(config: ReceivingServiceConfig): Router {
  const router = Router();
  const auth = buildBrokerAuthMiddleware(config);

  router.post('/loans', auth, async (req: AuthedRequest, res: Response) => {
    const principal = req.auth?.user?.sub ?? req.auth?.sub ?? req.auth?.principal ?? 'unknown';
    const loan: Loan = {
      loanId: `L-${randomUUID().slice(0, 8)}`,
      amount: Number(req.body?.amount ?? 0),
      applicantId: String(req.body?.applicantId ?? ''),
      createdBy: principal,
      createdAt: new Date().toISOString(),
    };
    store.push(loan);
    const userEcho = req.auth?.user
      ? {
          sub: req.auth.user.sub,
          roles: req.auth.user.roles,
          groups: req.auth.user.groups,
        }
      : undefined;
    const actorChainEcho = actorChainAsString(req.auth?.actor_chain ?? null);

    if (config.ledgerOutboundEnabled) {
      const correlationId =
        req.header('x-correlation-id') ?? req.header('x-request-id') ?? randomUUID();
      const reqLog = (req as Request & { log?: { error: (...a: unknown[]) => void; info: (...a: unknown[]) => void } }).log;
      try {
        const ledger = await postLedgerEntry(config, {
          correlationId,
          payload: { loanId: loan.loanId, amount: loan.amount },
          ...(req.auth?.token ? { subjectToken: req.auth.token } : {}),
        });
        reqLog?.info(
          { event: 'ledger.outbound.success', correlation_id: correlationId, loan_id: loan.loanId, entry_id: ledger.entryId },
          'ledger.outbound.success',
        );
        res.status(201).json({
          ...loan,
          ledger: { entryId: ledger.entryId, status: ledger.status },
          ...(userEcho ? { user: userEcho } : {}),
          actor_chain: actorChainEcho,
        });
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

    res.status(201).json({
      ...loan,
      ...(userEcho ? { user: userEcho } : {}),
      actor_chain: actorChainEcho,
    });
  });

  router.get('/loans', auth, (_req: Request, res: Response) => res.status(200).json(store));
  return router;
}
