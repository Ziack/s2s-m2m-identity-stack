import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { buildBrokerAuthMiddleware, actorChainAsString } from '../lib/brokerAuthMiddleware.js';
import type { LedgerServiceConfig } from '../config.js';
import type { UserContext, ActorChain } from '@s2s/auth-library';

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
    user?: UserContext;
    actor_chain?: ActorChain | null;
    token?: string;
  };
};

export function entriesRouter(config: LedgerServiceConfig): Router {
  const router = Router();
  const rg = `${config.resourcePrefix}-resources`;
  const postAuth = buildBrokerAuthMiddleware(config, { action: 'POST_ledger_entry', resourceGroup: rg });
  const getAuth = buildBrokerAuthMiddleware(config, { action: 'LIST_ledger_entries', resourceGroup: rg });

  router.post('/ledger/entries', postAuth, (req: AuthedRequest, res: Response) => {
    const principal = req.auth?.user?.sub ?? req.auth?.sub ?? req.auth?.principal ?? 'unknown';
    const entry: LedgerEntry = {
      entryId: `E-${randomUUID().slice(0, 8)}`,
      status: 'posted',
      amount: Number(req.body?.amount ?? 0),
      reference: String(req.body?.reference ?? ''),
      createdBy: principal,
      createdAt: new Date().toISOString(),
    };
    store.push(entry);
    res.status(201).json({
      entryId: entry.entryId,
      status: entry.status,
      audit: {
        user_sub: req.auth?.user?.sub ?? null,
        user_roles: req.auth?.user?.roles ?? [],
        actor_chain: actorChainAsString(req.auth?.actor_chain ?? null),
      },
    });
  });

  router.get('/ledger/entries', getAuth, (_req: Request, res: Response) => {
    res.status(200).json(store);
  });

  return router;
}
