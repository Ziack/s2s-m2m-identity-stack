import { Router, type Request, type Response, type NextFunction } from 'express';
import { newEnforcer, type Enforcer } from 'casbin';
import * as path from 'node:path';

// Resolved against the package root (process.cwd() in dev / vitest).
const modelPath = path.resolve('casbin/model.conf');
const policyPath = path.resolve('casbin/policy.csv');

let enforcerPromise: Promise<Enforcer> | undefined;
function getEnforcer(): Promise<Enforcer> {
  if (!enforcerPromise) enforcerPromise = newEnforcer(modelPath, policyPath);
  return enforcerPromise;
}

function userIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const sub = req.headers['x-user-id'];
  if (typeof sub !== 'string') return res.status(401).end();
  (req as Request & { user?: { id: string } }).user = { id: sub };
  next();
}

function enforce(obj: string, act: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sub = (req as Request & { user?: { id: string } }).user?.id;
    if (!sub) return res.status(401).end();
    const enf = await getEnforcer();
    const allowed = await enf.enforce(sub, obj, act);
    if (!allowed) return res.status(403).end();
    next();
  };
}

export const reportsRouter = Router();
reportsRouter.use(userIdMiddleware);
reportsRouter.get('/reports', enforce('/reports', 'read'), (_req, res) => {
  res.json({ reports: [{ id: 'r-1' }] });
});
reportsRouter.post('/reports', enforce('/reports', 'write'), (_req, res) => {
  res.status(201).json({ id: 'r-2' });
});
reportsRouter.delete('/reports/:id', enforce('/reports/:id', 'delete'), (_req, res) => {
  res.status(204).end();
});
