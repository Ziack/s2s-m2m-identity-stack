import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { initKeyPair } from '@s2s/auth-library';
import { loadConfig } from './config.js';
import { initEnvelopeAuth } from './lib/envelopeAuth.js';
import { loansRouter } from './routes/loans.js';
import { healthRouter } from './routes/health.js';
import { startSqsConsumer } from './consumers/sqsConsumer.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

async function main(): Promise<void> {
  await initKeyPair();
  initEnvelopeAuth(config);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(pinoHttp({ logger }));
  app.use(healthRouter(config));
  app.use('/api', loansRouter(config));
  app.listen(config.port, () => logger.info({ port: config.port }, 'receiving-service listening'));
  startSqsConsumer(config, logger).catch((err) => logger.error({ err }, 'consumer failed'));
}

main().catch((err) => { logger.error({ err }, 'fatal startup error'); process.exit(1); });
