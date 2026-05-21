import type { Request } from 'express';
import {
  createExchangeToken,
  signDPoP,
  withDPoPNonceRetry,
  getClientSecret,
} from '@s2s/auth-library';

const exchangeForLedger = createExchangeToken({
  brokerUrl: process.env.BROKER_TOKEN_ENDPOINT ?? 'http://broker.local/token',
  actorClientId: process.env.COGNITO_CLIENT_ID ?? 'orders',
  actorClientSecret: () =>
    getClientSecret(process.env.COGNITO_CLIENT_SECRET_ARN ?? 'arn:aws:secretsmanager:::orders'),
  audience: 'ledger',
  scope: ['ledger/write'],
});

export async function postLedgerEntry(req: Request, payload: unknown): Promise<Response> {
  const inbound = req.headers.authorization?.split(' ')[1] ?? '';
  const exchanged = await exchangeForLedger({ subjectToken: inbound });
  const url = `${process.env.LEDGER_URL ?? 'http://ledger.local'}/api/ledger/entries`;
  return withDPoPNonceRetry(async (nonce) => {
    const dpop = await signDPoP({
      accessToken: exchanged.accessToken,
      htm: 'POST',
      htu: url,
      nonce,
    });
    return fetch(url, {
      method: 'POST',
      headers: {
        authorization: `DPoP ${exchanged.accessToken}`,
        dpop: dpop.proof,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  });
}
