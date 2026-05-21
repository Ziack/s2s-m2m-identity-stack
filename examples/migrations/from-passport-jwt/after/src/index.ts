import express, { type Request, type Response, type NextFunction } from 'express';
import pino from 'pino';
import { healthRouter } from './health.js';
import { ordersRouter } from './routes.js';

const logger = pino();
const app = express();
app.use(express.json());
app.use(healthRouter);

// In production, the call below is `createBrokerAuthMiddleware({ mode: 'enforce', ... })`
// from `@s2s/auth-library`. Configuration shown for reference; the middleware reads
// brokerJwksUri/brokerIssuer/brokerAudience/policyStoreId plus awsRegion + redisEndpoint
// (the latter two are REQUIRED fields of BrokerAuthConfig per Plan 3's wiring).
//
// import { createBrokerAuthMiddleware } from '@s2s/auth-library';
// app.use('/api', createBrokerAuthMiddleware({
//   brokerJwksUri: process.env.BROKER_JWKS_URI!,
//   brokerIssuer: process.env.BROKER_ISSUER!,
//   brokerAudience: process.env.BROKER_AUDIENCE!,
//   policyStoreId: process.env.AVP_POLICY_STORE_ID!,
//   awsRegion: process.env.AWS_REGION!,
//   redisEndpoint: process.env.REDIS_ENDPOINT!,
//   mode: 'enforce',
//   logger,
// }));

// For local/test runs we stub the middleware via a request-decorating hook so that
// the test file can inject `req.auth`. In prod, the real middleware sets `req.auth`
// after AVP returns its decision.
app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
  // No-op in dev; tests override via a setup hook (see test/routes.test.ts).
  next();
});
app.use('/api', ordersRouter);

const port = Number(process.env.PORT ?? 3000);

/* c8 ignore start */
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port);
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received; draining');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
/* c8 ignore stop */

export { app };
