/**
 * Job B (v2.2.0 Phase 3): assert the exchange-request DPoP proof and the
 * subsequent resource-call DPoP proof in a single outbound flow carry the SAME
 * JWK thumbprint.
 *
 * Why this matters: the broker mints the exchanged token's `cnf.jkt` from the
 * EXCHANGE proof's key. The receiver then enforces that the RESOURCE proof's
 * key thumbprint == that cnf.jkt. If the two proofs used different keys the
 * receiver would (correctly) reject every legitimate call. Both proofs are
 * produced via the process `keyManager` singleton (createExchangeToken's
 * default DPoP signer + signDPoP both read getPublicJwk/getActivePrivateKey),
 * so the thumbprints must coincide. This test pins that invariant — exactly the
 * guarantee calling-service `routes/sync.ts` and receiving `lib/ledgerClient.ts`
 * depend on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { decodeProtectedHeader, calculateJwkThumbprint, type JWK } from 'jose';
import { initKeyPair, getJwkThumbprint, rotateKey, _resetKeyManagerForTest } from '../../src/dpop/keyManager.js';
import { signDPoP } from '../../src/dpop/signDPoP.js';
import { createExchangeToken } from '../../src/auth/exchangeToken.js';

async function thumbprintOfProof(proof: string): Promise<string> {
  const header = decodeProtectedHeader(proof);
  return calculateJwkThumbprint(header.jwk as JWK, 'sha256');
}

describe('exchange proof + resource proof share the DPoP key (Job B)', () => {
  let capturedExchangeProof: string;

  beforeEach(async () => {
    _resetKeyManagerForTest();
    await initKeyPair();
  });

  it('captures the exchange-request proof and a resource-call proof with equal thumbprint', async () => {
    // Drive the REAL createExchangeToken with its default DPoP signer (process
    // key). Stub fetch so we capture the DPoP header the SDK actually sent.
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      capturedExchangeProof = headers.DPoP;
      return new Response(
        JSON.stringify({ access_token: 'exchanged-tok', token_type: 'DPoP', expires_in: 300 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const exchange = createExchangeToken({
      brokerUrl: 'https://broker.test/oauth2/token',
      actorClientId: 'calling-service',
      actorClientSecret: 'secret',
      audience: 'receiving',
      scope: ['lending/write'],
      fetchImpl,
    });

    const exchanged = await exchange({ subjectToken: 'user-token' });

    // Resource-call proof (what routes/sync.ts signs after exchange), bound to
    // the freshly-exchanged access token.
    const resource = await signDPoP({
      accessToken: exchanged.accessToken,
      htm: 'POST',
      htu: 'https://receiving.test/api/loans',
    });

    const exchangeJkt = await thumbprintOfProof(capturedExchangeProof);
    const resourceJkt = await thumbprintOfProof(resource.proof);

    // Both proofs carry the SAME key -> resource proof thumbprint will equal the
    // token's cnf.jkt the broker derives from the exchange proof.
    expect(exchangeJkt).toBe(resourceJkt);
    // And both equal the process key's thumbprint.
    expect(exchangeJkt).toBe(getJwkThumbprint());
  });

  it('after key rotation both proofs still share the (new) key', async () => {
    await rotateKey();
    const afterRotate = getJwkThumbprint();

    let captured = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      captured = (init.headers as Record<string, string>).DPoP;
      return new Response(
        JSON.stringify({ access_token: 't', token_type: 'DPoP', expires_in: 300 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const exchange = createExchangeToken({
      brokerUrl: 'https://broker.test/oauth2/token',
      actorClientId: 'calling-service',
      actorClientSecret: 'secret',
      audience: 'receiving',
      scope: [],
      fetchImpl,
    });
    const exchanged = await exchange({ subjectToken: 'user-token' });
    const resource = await signDPoP({ accessToken: exchanged.accessToken, htm: 'POST', htu: 'https://r/x' });

    expect(await thumbprintOfProof(captured)).toBe(afterRotate);
    expect(await thumbprintOfProof(resource.proof)).toBe(afterRotate);
  });
});
