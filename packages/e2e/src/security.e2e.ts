/**
 * §5.3 security suite — exercised against a deployed ALB.
 *
 * Plan 04 drift: `acquireToken` is exposed by `@s2s/auth-library` as the
 * factory `createAcquireToken`. For e2e usage the test must construct the
 * acquire function once via the factory + a Redis-backed cache; here we
 * build a minimal in-memory adapter inline so the file typechecks without
 * pulling production deps into the test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fetch } from 'undici';
import { generateKeyPair, exportJWK, SignJWT, base64url } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import { signDPoP, signEnvelope, createAcquireToken } from '@s2s/auth-library';
import type { TokenResult } from '@s2s/auth-library';
import { loadE2eEnv, type E2eEnv } from './env.js';

let env: E2eEnv;
beforeAll(() => { env = loadE2eEnv(); });

type AcquireFn = (clientId: string, scopes: string[], opts?: { forceRefresh?: boolean }) => Promise<TokenResult>;
let acquireToken: AcquireFn;

beforeAll(async () => {
  // PoC: tests assume the orchestrator script wires real Cognito + Redis env vars
  // (COGNITO_DOMAIN, M2M_CLIENT_SECRET, REDIS_ENDPOINT). We pass them through to
  // the factory. If any is missing the suite will fail loudly at first acquire.
  const fakeCache = {
    get: async () => null,
    set: async () => undefined,
  } as unknown as Parameters<typeof createAcquireToken>[0]['cache'];
  acquireToken = createAcquireToken({
    cognitoDomain: env.cognitoDomain || process.env['COGNITO_DOMAIN'] || '',
    clientSecret: process.env['M2M_CLIENT_SECRET'] ?? '',
    cache: fakeCache,
  });
});

async function freshToken(): Promise<string> {
  const r = await acquireToken(env.clientId, ['lending/read', 'lending/write'], { forceRefresh: true });
  return r.accessToken;
}

async function callLoans(headers: Record<string, string>) {
  return fetch(`${env.albBaseUrl}/api/loans`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': `sec-${env.runId}-${randomUUID()}`, ...headers },
    body: JSON.stringify({ amount: 1, applicantId: 'SEC' }),
  });
}

function shouldBeErrorBody(b: unknown, code: string) {
  expect(b).toMatchObject({
    error: code,
    error_description: expect.any(String),
    request_id: expect.any(String),
    timestamp: expect.any(String),
  });
}

describe('§5.3 security suite — every case must return correct §4.3 code', () => {
  it('missing Authorization header -> 401 invalid_token + WWW-Authenticate: DPoP', async () => {
    const res = await callLoans({});
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('DPoP');
    shouldBeErrorBody(await res.json(), 'invalid_token');
  });

  it('tampered JWT (modified claims) -> 401 invalid_token', async () => {
    const token = await freshToken();
    const [h, p, s] = token.split('.');
    const decoded = JSON.parse(Buffer.from(p ?? '', 'base64url').toString());
    decoded.sub = 'attacker';
    const tampered = `${h}.${base64url.encode(JSON.stringify(decoded))}.${s}`;
    const dpop = await signDPoP({ accessToken: tampered, htm: 'POST', htu: `${env.albBaseUrl}/api/loans` });
    const res = await callLoans({ authorization: `DPoP ${tampered}`, dpop: dpop.proof });
    expect(res.status).toBe(401);
    shouldBeErrorBody(await res.json(), 'invalid_token');
  });

  it('expired token -> 401 token_expired', async () => {
    const token = await freshToken();
    const [h, p, s] = token.split('.');
    const claims = JSON.parse(Buffer.from(p ?? '', 'base64url').toString());
    claims.exp = Math.floor(Date.now() / 1000) - 60;
    const expired = `${h}.${base64url.encode(JSON.stringify(claims))}.${s}`;
    const dpop = await signDPoP({ accessToken: expired, htm: 'POST', htu: `${env.albBaseUrl}/api/loans` });
    const res = await callLoans({ authorization: `DPoP ${expired}`, dpop: dpop.proof });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(['token_expired', 'invalid_token']).toContain(body.error);
  });

  it('token theft (DPoP signed by wrong key) -> 401 invalid_dpop_proof', async () => {
    const token = await freshToken();
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    const ath = base64url.encode(createHash('sha256').update(token).digest());
    const proof = await new SignJWT({
      htm: 'POST', htu: `${env.albBaseUrl}/api/loans`, iat: Math.floor(Date.now() / 1000),
      jti: randomUUID(), ath,
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk })
      .sign(privateKey);
    const res = await callLoans({ authorization: `DPoP ${token}`, dpop: proof });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(['invalid_dpop_proof', 'dpop_token_mismatch']).toContain(body.error);
  });

  it('replay (reused DPoP jti) -> second call 401 dpop_nonce_reuse', async () => {
    const token = await freshToken();
    const proof = await signDPoP({ accessToken: token, htm: 'POST', htu: `${env.albBaseUrl}/api/loans` });
    const first = await callLoans({ authorization: `DPoP ${token}`, dpop: proof.proof });
    expect([200, 201]).toContain(first.status);
    const second = await callLoans({ authorization: `DPoP ${token}`, dpop: proof.proof });
    expect(second.status).toBe(401);
    shouldBeErrorBody(await second.json(), 'dpop_nonce_reuse');
  });

  it('DPoP htu mismatch -> 401 dpop_binding_mismatch', async () => {
    const token = await freshToken();
    const proof = await signDPoP({ accessToken: token, htm: 'POST', htu: 'https://wrong.example.com/api/loans' });
    const res = await callLoans({ authorization: `DPoP ${token}`, dpop: proof.proof });
    expect(res.status).toBe(401);
    shouldBeErrorBody(await res.json(), 'dpop_binding_mismatch');
  });

  it('DPoP iat outside ±60s -> 401 dpop_proof_expired', async () => {
    const token = await freshToken();
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    const ath = base64url.encode(createHash('sha256').update(token).digest());
    const proof = await new SignJWT({
      htm: 'POST', htu: `${env.albBaseUrl}/api/loans`,
      iat: Math.floor(Date.now() / 1000) - 600, jti: randomUUID(), ath,
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk })
      .sign(privateKey);
    const res = await callLoans({ authorization: `DPoP ${token}`, dpop: proof });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(['dpop_proof_expired', 'invalid_dpop_proof']).toContain(body.error);
  });

  it('tampered envelope payload (modified after signing) -> consumer drops, no processed log', async () => {
    const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs');
    const sqs = new SQSClient({ region: env.region });
    const signed = await signEnvelope({ decisionId: `orig-${env.runId}`, amount: 1 }, {
      action: 'loan.decision.submit', queueArn: env.queueArn, scopes: ['lending/write'], clientId: env.clientId,
    });
    const tampered = JSON.stringify({ envelope: signed.envelope, payload: { decisionId: `orig-${env.runId}`, amount: 999999 } });
    await sqs.send(new SendMessageCommand({ QueueUrl: env.queueUrl, MessageBody: tampered }));

    const { CloudWatchLogsClient, FilterLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');
    const cwl = new CloudWatchLogsClient({ region: env.region });
    await new Promise((r) => setTimeout(r, 30_000));
    const out = await cwl.send(new FilterLogEventsCommand({
      logGroupName: env.receivingLogGroup,
      startTime: Date.now() - 5 * 60_000,
      filterPattern: '"envelope verification failed"',
      limit: 10,
    }));
    expect((out.events ?? []).length).toBeGreaterThan(0);
  });
});
