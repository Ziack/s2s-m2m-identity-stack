import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { initKeyPair } from '@s2s/auth-library';
import { loadConfig } from './config.js';
import { initAuthClient } from './lib/authClient.js';
import { syncRouter } from './routes/sync.js';
import { asyncRouter } from './routes/async.js';
import { jwksRouter } from './routes/jwks.js';
import { metricsRouter } from './routes/metrics.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

async function main(): Promise<void> {
  await initKeyPair();
  await initAuthClient(config);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(pinoHttp({ logger }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/demo', syncRouter(config));
  app.use('/demo', asyncRouter(config));
  app.use(jwksRouter());
  app.use(metricsRouter());
  app.listen(config.port, () => logger.info({ port: config.port }, 'calling-service listening'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
