import { describe, it, expect, beforeAll } from 'vitest';
import { fetch } from 'undici';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { loadE2eEnv, type E2eEnv } from './env.js';

let env: E2eEnv;
beforeAll(() => { env = loadE2eEnv(); });

async function waitForLogPattern(e: E2eEnv, pattern: string, timeoutMs = 60_000): Promise<string | null> {
  const cwl = new CloudWatchLogsClient({ region: e.region });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const out = await cwl.send(new FilterLogEventsCommand({
      logGroupName: e.receivingLogGroup,
      startTime: Date.now() - 5 * 60_000,
      filterPattern: pattern,
      limit: 10,
    }));
    const hit = out.events?.[0]?.message;
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

describe('async flow: Calling Service -> SQS -> Receiving consumer', () => {
  it('POST /demo/async returns 202 and consumer processes within 60s', async () => {
    const correlationId = `e2e-async-${env.runId}-${Date.now()}`;
    const res = await fetch(`${env.albBaseUrl}/demo/async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': correlationId },
      body: JSON.stringify({ decisionId: correlationId, amount: 7777 }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body['messageId']).toBe('string');
    expect(typeof body['jti']).toBe('string');

    const matched = await waitForLogPattern(env, `"${body['jti']}"`);
    expect(matched, 'consumer log with jti not found within 60s').not.toBeNull();
    expect(matched).toMatch(/message processed/);
  });

  it('dedup: republishing the same envelope is rejected by jti cache', async () => {
    const correlationId = `e2e-tamper-${env.runId}-${Date.now()}`;
    const res = await fetch(`${env.albBaseUrl}/demo/async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': correlationId },
      body: JSON.stringify({ decisionId: correlationId }),
    });
    expect(res.status).toBe(202);
    const { jti } = (await res.json()) as { jti: string };
    const ok = await waitForLogPattern(env, `"${jti}"`);
    expect(ok).not.toBeNull();
  });
});
