import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { reportsRouter } from '../src/routes.js';
import { healthRouter } from '../src/health.js';

interface AuthInjection {
  decision: 'allow' | 'deny';
}

function buildApp(auth: AuthInjection) {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { auth?: AuthInjection }).auth = auth;
    next();
  });
  app.use('/api', reportsRouter);
  return app;
}

describe('casbin-rbac after app', () => {
  it('admin (allow) → DELETE 204', async () => {
    const app = buildApp({ decision: 'allow' });
    const res = await request(app).delete('/api/reports/r-1');
    expect(res.status).toBe(204);
  });

  it('analyst on delete (deny) → 403', async () => {
    const app = buildApp({ decision: 'deny' });
    const res = await request(app).delete('/api/reports/r-1');
    expect(res.status).toBe(403);
  });

  it('admin (allow) → GET 200', async () => {
    const app = buildApp({ decision: 'allow' });
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(200);
  });
});
