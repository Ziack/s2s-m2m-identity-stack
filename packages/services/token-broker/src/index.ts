import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { getRedisClient } from '@s2s/auth-library';
import { loadConfig } from './config.js';
import { createSigningKeyLoader } from './lib/signingKeyLoader.js';
import { loadActorCatalogFromFile } from './lib/actorCatalog.js';
import { createSubjectTokenValidator } from './lib/subjectTokenValidator.js';
import { createReplayStore } from './lib/replayStore.js';
import { tokenRouter } from './routes/token.js';
import { jwksRouter } from './routes/jwks.js';
import { discoveryRouter } from './routes/discovery.js';
import { buildBrokerMetrics, metricsRouter } from './routes/metrics.js';
import { healthRouter } from './routes/health.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });

  const signingKey = createSigningKeyLoader({
    secretArn: config.brokerSigningKeySecretArn,
    region: config.awsRegion,
    ttlMs: config.signingKeyTtlMs,
  });
  // Warm cache at startup so /jwks.json serves immediately.
  await signingKey.get();

  const catalog = loadActorCatalogFromFile(config.actorCatalogPath);
  logger.info({ actors: catalog.list() }, 'actor catalog loaded');

  const subjectValidator = createSubjectTokenValidator({
    brokerIssuerUrl: config.brokerIssuerUrl,
    brokerJwksUri: `${config.brokerIssuerUrl}/.well-known/jwks.json`,
    userIssuerUrl: config.userIssuerUrl,
    userIssuerJwksUri: config.userIssuerJwksUri,
    userIssuerAudience: config.userIssuerAudience,
    jwksRefreshHours: config.jwksRefreshHours,
  });

  const redis = getRedisClient(config.redisEndpoint);
  const replayStore = createReplayStore({
    redis: redis as unknown as Parameters<typeof createReplayStore>[0]['redis'],
    ttlSeconds: config.replayTtlSeconds,
  });

  const metrics = buildBrokerMetrics();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));
  app.use(pinoHttp({ logger }));

  const healthDeps = {
    signingKey,
    redis: redis as unknown as Parameters<typeof createReplayStore>[0]['redis'] & { ping: () => Promise<string> },
  };
  app.use(healthRouter(healthDeps));
  app.use(discoveryRouter(config));
  app.use(jwksRouter(signingKey));
  app.use(metricsRouter(metrics));
  app.use(tokenRouter({ config, catalog, signingKey, subjectValidator, replayStore, metrics }));

  app.listen(config.port, () => logger.info({ port: config.port }, 'token-broker listening'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal startup error', err);
  process.exit(1);
});
