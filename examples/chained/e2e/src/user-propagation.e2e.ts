/**
 * User-identity propagation matrix.
 *
 * Exercises the full on-behalf-of chain (calling -> broker -> receiving ->
 * broker -> ledger) with three hardcoded test users whose role sets cover
 * three distinct authorization outcomes:
 *
 *   alice (loan-officer + reader)  -> full ALLOW through ledger
 *   bob   (auditor + reader)       -> receiving ALLOW, ledger DENY
 *                                     (surfaces as 502 downstream_unavailable)
 *   carol (reader only)            -> receiving DENY (403 from upstream Cedar)
 *
 * Self-skips when `tf-outputs.json` is absent, so it remains a no-op in
 * code-only mode. The deployed stack's calling-service mints user JWTs via
 * its local IdP (POST /auth/login), and /demo/sync wraps the downstream
 * receiving response as `{ downstream, user }`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fetch, type Response as UndiciResponse } from 'undici';
import { loadE2eEnv, type E2eEnv } from './env.js';

const env = loadE2eEnv({ optional: true });
const SKIP = env === null;

interface LoginResponse {
  user_token: string;
  // Local IdP also returns id_token / expires_in; we only need user_token.
}

interface SyncEnvelope {
  downstream: unknown;
  user: { sub: string; roles: string[] };
}

interface ReceivingSuccess {
  loanId: string;
  amount: number;
  createdBy: string;
  user?: { sub: string; roles: string[]; groups: string[] };
  actor_chain: string | null;
  ledger?: { entryId: string; status: string };
}

interface ErrorBody {
  error: string;
  error_description?: string;
}

async function loginAs(callingUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${callingUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`login failed for ${username}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as LoginResponse;
  if (typeof body.user_token !== 'string' || body.user_token.length === 0) {
    throw new Error(`login response for ${username} missing user_token`);
  }
  return body.user_token;
}

async function postSync(
  callingUrl: string,
  userToken: string,
  payload: Record<string, unknown>,
  runId: string,
): Promise<UndiciResponse> {
  return fetch(`${callingUrl}/demo/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${userToken}`,
      'x-correlation-id': `e2e-${runId}-${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });
}

describe.skipIf(SKIP)('user identity propagation matrix', () => {
  // `env` is guaranteed non-null inside this block because SKIP gates it.
  const e = env as E2eEnv;

  let aliceToken: string;
  let bobToken: string;
  let carolToken: string;

  beforeAll(async () => {
    aliceToken = await loginAs(e.callingUrl, 'alice', 'alice-pw');
    bobToken = await loginAs(e.callingUrl, 'bob', 'bob-pw');
    carolToken = await loginAs(e.callingUrl, 'carol', 'carol-pw');
  });

  describe('alice (loan-officer + reader)', () => {
    it('full chain ALLOW: receiving + ledger both accept; chain echoed back', async () => {
      const res = await postSync(
        e.callingUrl,
        aliceToken,
        { amount: 4242, applicantId: `e2e-alice-${e.runId}` },
        e.runId,
      );
      expect([200, 201]).toContain(res.status);
      const body = (await res.json()) as SyncEnvelope;
      expect(body.user.sub).toBe('user-alice');
      const downstream = body.downstream as ReceivingSuccess;
      expect(downstream.user?.sub).toBe('user-alice');
      // actor_chain string is comma-joined innermost-first.
      expect(downstream.actor_chain).toMatch(/calling-service/);
      expect(downstream.actor_chain).toMatch(/receiving-service-outbound/);
      // ledger.outbound is enabled in the deployed stack for this matrix.
      expect(downstream.ledger?.entryId).toBeTruthy();
    });
  });

  describe('bob (auditor + reader)', () => {
    it('receiving ALLOW, ledger DENY: surfaces as 502 downstream_unavailable', async () => {
      const res = await postSync(
        e.callingUrl,
        bobToken,
        { amount: 555, applicantId: `e2e-bob-${e.runId}` },
        e.runId,
      );
      // Calling-service passes the upstream status through. Receiving returns
      // 502 downstream_unavailable when its outbound to ledger fails (403).
      expect(res.status).toBe(502);
      const body = (await res.json()) as SyncEnvelope;
      const downstream = body.downstream as ErrorBody;
      expect(downstream.error).toBe('downstream_unavailable');
    });
  });

  describe('carol (reader-only)', () => {
    it('receiving DENY: Cedar forbids at the entry edge (403)', async () => {
      const res = await postSync(
        e.callingUrl,
        carolToken,
        { amount: 1, applicantId: `e2e-carol-${e.runId}` },
        e.runId,
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as SyncEnvelope;
      const downstream = body.downstream as ErrorBody;
      // Receiving's Cedar middleware emits `authorization_denied` (or an
      // equivalent forbid code). Match loosely so we don't couple to the
      // exact error string while still proving it's an auth failure.
      expect(downstream.error).toMatch(/denied|forbidden|authoriz/i);
    });
  });

  describe('cross-cutting assertions', () => {
    it('actor_chain ordering: innermost first (calling -> receiving-outbound)', async () => {
      const res = await postSync(
        e.callingUrl,
        aliceToken,
        { amount: 9001, applicantId: `e2e-chain-${e.runId}` },
        e.runId,
      );
      expect([200, 201]).toContain(res.status);
      const body = (await res.json()) as SyncEnvelope;
      const downstream = body.downstream as ReceivingSuccess;
      const chain = (downstream.actor_chain ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      expect(chain.length).toBeGreaterThanOrEqual(2);
      expect(chain[0]).toBe('calling-service');
      expect(chain[chain.length - 1]).toBe('receiving-service-outbound');
    });

    it('user.sub binds to token holder, not to header tampering', async () => {
      // Even if a caller fabricates an x-user-sub header, the calling service
      // derives identity from the cryptographically verified token claim.
      const res = await fetch(`${e.callingUrl}/demo/sync`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${aliceToken}`,
          'x-user-sub': 'user-bob', // attempted impersonation
          'x-correlation-id': `e2e-tamper-${e.runId}-${Date.now()}`,
        },
        body: JSON.stringify({ amount: 7, applicantId: `e2e-tamper-${e.runId}` }),
      });
      // alice has full ALLOW, so this should succeed.
      expect([200, 201]).toContain(res.status);
      const body = (await res.json()) as SyncEnvelope;
      expect(body.user.sub).toBe('user-alice');
    });
  });
});
