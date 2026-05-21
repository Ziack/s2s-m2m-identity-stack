import express from 'express';
import pino from 'pino';
import { healthRouter } from './health.js';
import { internalRouter } from './routes.js';

const logger = pino();
const app = express();
app.use(express.json());
app.use(healthRouter);

// In production:
// import { createBrokerAuthMiddleware } from '@s2s/auth-library';
// app.use('/internal', createBrokerAuthMiddleware({ ..., mode: 'enforce' }));
app.use(internalRouter);

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
