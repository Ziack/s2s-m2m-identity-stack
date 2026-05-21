import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Mock global fetch (postLedgerEntry uses it).
const fetchMock = vi.fn();
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
  // @ts-expect-error override
  globalThis.fetch = fetchMock;
});
afterAll(() => {
  fetchMock.mockReset();
});

async function loadApp() {
  const mod = await import('../src/index.js');
  return mod.app;
}

function signed(payload: Record<string, unknown>): string {
  return jwt.sign(payload, 'test-secret');
}

describe('passport-jwt before app', () => {
  it('manager JWT → 201 on POST /orders/:id/approve', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    const app = await loadApp();
    const token = signed({ sub: 'alice', roles: ['manager'] });
    const res = await request(app)
      .post('/api/orders/ord-1/approve')
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('unsigned request → 401', async () => {
    const app = await loadApp();
    const res = await request(app).post('/api/orders/ord-1/approve').send({});
    expect(res.status).toBe(401);
  });

  it('JWT without manager role → 403', async () => {
    const app = await loadApp();
    const token = signed({ sub: 'bob', roles: ['viewer'] });
    const res = await request(app)
      .post('/api/orders/ord-1/approve')
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
