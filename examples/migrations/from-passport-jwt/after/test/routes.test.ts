import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { ordersRouter } from '../src/routes.js';
import { healthRouter } from '../src/health.js';

interface AuthInjection {
  decision: 'allow' | 'deny';
  principal?: string;
  actorChain?: string[];
}

function buildApp(auth: AuthInjection | undefined) {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
    if (auth) (req as Request & { auth?: AuthInjection }).auth = auth;
    next();
  });
  app.use('/api', ordersRouter);
  return app;
}

describe('passport-jwt after app', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  it('allow decision → 201 on POST /orders/:id/approve', async () => {
    const app = buildApp({ decision: 'allow', principal: 'alice', actorChain: ['orders'] });
    const res = await request(app).post('/api/orders/ord-1/approve').send({});
    expect(res.status).toBe(201);
    expect(res.body.principal).toBe('alice');
  });

  it('deny decision → 403', async () => {
    const app = buildApp({ decision: 'deny' });
    const res = await request(app).post('/api/orders/ord-1/approve').send({});
    expect(res.status).toBe(403);
  });

  it('/health works without auth', async () => {
    const app = buildApp(undefined);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
