import type { Request } from 'express';

/**
 * Legacy "just forward the inbound bearer" pattern. Phase 3 of the migration
 * replaces this with `createExchangeToken` + `signDPoP` + `withDPoPNonceRetry`.
 */
export async function postLedgerEntry(req: Request, payload: unknown): Promise<Response> {
  const url = `${process.env.LEDGER_URL ?? 'http://ledger.local'}/api/ledger/entries`;
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: req.headers.authorization ?? '',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}
