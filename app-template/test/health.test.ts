import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { healthRouter } from '../src/routes/health.js';

describe('healthRouter', () => {
  const app = express();
  app.use(healthRouter);

  it('GET /health -> 200', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('GET /health/auth -> 200', async () => {
    const r = await request(app).get('/health/auth');
    expect(r.status).toBe(200);
  });
});
