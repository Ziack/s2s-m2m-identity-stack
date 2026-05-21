import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

describe('no-auth before app', () => {
  it('GET /internal/status returns 200 for any caller', async () => {
    const res = await request(app).get('/internal/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /internal/refresh-cache returns 200 for any caller', async () => {
    const res = await request(app).post('/internal/refresh-cache').send({});
    expect(res.status).toBe(200);
    expect(res.body.refreshed).toBe(true);
  });
});
