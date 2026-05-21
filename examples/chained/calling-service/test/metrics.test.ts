import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { metricsRouter } from '../src/routes/metrics.js';

describe('GET /metrics', () => {
  it('returns prometheus exposition format text', async () => {
    const app = express().use(metricsRouter());
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# HELP');
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });
});
