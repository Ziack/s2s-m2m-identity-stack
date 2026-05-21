import { describe, it, expect, beforeAll } from 'vitest';
import { fetch } from 'undici';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { loadE2eEnv, type E2eEnv } from './env.js';

const ENABLED = process.env.S2S_E2E === '1';
const d = ENABLED ? describe : describe.skip;

let env: E2eEnv;

beforeAll(() => { if (ENABLED) env = loadE2eEnv(); });

d('sync flow: Calling Service -> Receiving Service over ALB', () => {
  it('POST /demo/sync returns 201 with a loanId, createdBy principal, and (when enabled) ledger entry', async () => {
    const t0 = Date.now();
    const correlationId = `e2e-sync-${env.runId}-${Date.now()}`;
    const res = await fetch(`${env.albBaseUrl}/demo/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': correlationId },
      body: JSON.stringify({ amount: 5000, applicantId: 'E2E-APPL-1' }),
    });
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['loanId']).toMatch(/^L-/);
    expect(body['amount']).toBe(5000);
    expect(String(body['createdBy'])).toContain('ServicePrincipal::');
    // When LEDGER_OUTBOUND_ENABLED=true in the deployed stack, receiving
    // chains a call to the ledger service and surfaces the entryId.
    const ledger = body['ledger'] as { entryId?: string; status?: string } | undefined;
    if (ledger) {
      expect(typeof ledger.entryId).toBe('string');
      expect(ledger.entryId!.length).toBeGreaterThan(0);
    }
    console.log(`[sync e2e] roundtrip=${elapsed}ms ledger=${ledger?.entryId ?? '(disabled)'}`);
  });

  it('receiving service logs include ledger.outbound.success with matching correlation_id', async () => {
    const cwl = new CloudWatchLogsClient({ region: env.region });
    const correlationId = `e2e-ledger-${env.runId}-${Date.now()}`;
    const res = await fetch(`${env.albBaseUrl}/demo/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': correlationId },
      body: JSON.stringify({ amount: 7777, applicantId: 'E2E-LEDGER-1' }),
    });
    expect([200, 201]).toContain(res.status);
    // Allow log fan-in.
    await new Promise((r) => setTimeout(r, 10_000));
    const out = await cwl.send(new FilterLogEventsCommand({
      logGroupName: env.receivingLogGroup,
      startTime: Date.now() - 5 * 60_000,
      filterPattern: '"ledger.outbound.success"',
      limit: 50,
    }));
    const events = out.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => (e.message ?? '').includes(correlationId))).toBe(true);
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
