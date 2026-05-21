import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

describe('casbin before app', () => {
  it('x-user-id: bob → DELETE /reports/:id 204', async () => {
    const res = await request(app).delete('/api/reports/r-1').set('x-user-id', 'bob');
    expect(res.status).toBe(204);
  });

  it('x-user-id: alice → DELETE /reports/:id 403', async () => {
    const res = await request(app).delete('/api/reports/r-1').set('x-user-id', 'alice');
    expect(res.status).toBe(403);
  });

  it('x-user-id: alice → GET /reports 200', async () => {
    const res = await request(app).get('/api/reports').set('x-user-id', 'alice');
    expect(res.status).toBe(200);
  });
});
