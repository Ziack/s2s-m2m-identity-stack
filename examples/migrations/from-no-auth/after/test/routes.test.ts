import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { internalRouter } from '../src/routes.js';
import { healthRouter } from '../src/health.js';

interface AuthInjection {
  decision: 'allow' | 'deny';
  actorChain?: string[];
}

function buildApp(auth: AuthInjection | undefined) {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (auth) (req as Request & { auth?: AuthInjection }).auth = auth;
    next();
  });
  app.use(internalRouter);
  return app;
}

describe('no-auth after app', () => {
  it('allow with platform actor chain → 200', async () => {
    const app = buildApp({ decision: 'allow', actorChain: ['platform'] });
    const res = await request(app).get('/internal/status');
    expect(res.status).toBe(200);
  });

  it('missing chain entry → 403', async () => {
    const app = buildApp({ decision: 'deny' });
    const res = await request(app).post('/internal/refresh-cache').send({});
    expect(res.status).toBe(403);
  });

  it('/health open (no auth required)', async () => {
    const app = buildApp(undefined);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
