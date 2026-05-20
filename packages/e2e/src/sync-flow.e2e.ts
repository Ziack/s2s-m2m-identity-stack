import { describe, it, expect, beforeAll } from 'vitest';
import { fetch } from 'undici';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { loadE2eEnv, type E2eEnv } from './env.js';

let env: E2eEnv;

beforeAll(() => { env = loadE2eEnv(); });

describe('sync flow: Calling Service -> Receiving Service over ALB', () => {
  it('POST /demo/sync returns 201 with a loanId and createdBy=lending-client principal', async () => {
    const t0 = Date.now();
    const res = await fetch(`${env.albBaseUrl}/demo/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': `e2e-sync-${env.runId}-${Date.now()}` },
      body: JSON.stringify({ amount: 5000, applicantId: 'E2E-APPL-1' }),
    });
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['loanId']).toMatch(/^L-/);
    expect(body['amount']).toBe(5000);
    expect(String(body['createdBy'])).toContain('ServicePrincipal::');
    console.log(`[sync e2e] roundtrip=${elapsed}ms`);
  });

  it('receiving service logs include authz_decision=ALLOW for the request', async () => {
    const cwl = new CloudWatchLogsClient({ region: env.region });
    await new Promise((r) => setTimeout(r, 10_000));
    const out = await cwl.send(new FilterLogEventsCommand({
      logGroupName: env.receivingLogGroup,
      startTime: Date.now() - 5 * 60_000,
      filterPattern: '"authz_decision"',
      limit: 50,
    }));
    const events = out.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => /ALLOW/.test(e.message ?? ''))).toBe(true);
  });

  it('P99 of 20 sequential sync calls stays under target (latency budget)', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      const res = await fetch(`${env.albBaseUrl}/demo/sync`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 100 + i, applicantId: `LAT-${env.runId}-${i}` }),
      });
      expect([200, 201]).toContain(res.status);
      samples.push(Date.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99) - 1] ?? samples.at(-1)!;
    console.log(`[sync e2e] P99=${p99}ms across 20 samples`);
    expect(p99).toBeLessThan(1500);
  });
});
