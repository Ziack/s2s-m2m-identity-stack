import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { initKeyPair } from '@s2s/auth-library';
import { loadConfig } from './config.js';
import { entriesRouter } from './routes/entries.js';
import { healthRouter } from './routes/health.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

async function main(): Promise<void> {
  await initKeyPair();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(pinoHttp({ logger }));
  app.use(healthRouter(config));
  app.use('/api', entriesRouter(config));
  app.listen(config.port, () => logger.info({ port: config.port }, 'ledger-service listening'));
}

main().catch((err) => { logger.error({ err }, 'fatal startup error'); process.exit(1); });
