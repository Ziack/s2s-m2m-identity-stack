import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { getRedisClient } from '@s2s/auth-library';
import { loadConfig } from './config.js';
import { createSigningKeyLoader } from './lib/signingKeyLoader.js';
import { loadActorCatalogFromFile, loadActorCatalogFromSecretsManager } from './lib/actorCatalog.js';
import { createSubjectTokenValidator } from './lib/subjectTokenValidator.js';
import { createReplayStore } from './lib/replayStore.js';
import { tokenRouter } from './routes/token.js';
import { jwksRouter } from './routes/jwks.js';
import { discoveryRouter } from './routes/discovery.js';
import { buildBrokerMetrics, metricsRouter } from './routes/metrics.js';
import { healthRouter } from './routes/health.js';

/**
 * Build the broker Express app from a loaded config. Extracted from main()
 * so the boot integration test can exercise the TF env-var contract end-to-
 * end without binding a real port.
 */
export async function buildApp(config: ReturnType<typeof loadConfig>): Promise<express.Express> {
  const logger = pino({ level: config.logLevel });

  const signingKey = createSigningKeyLoader({
    secretArn: config.brokerSigningKeySecretArn,
    region: config.awsRegion,
    ttlMs: config.signingKeyTtlMs,
  });
  // Warm cache at startup so /jwks.json serves immediately.
  await signingKey.get();

  const catalog = config.actorCatalogSecretArn
    ? await loadActorCatalogFromSecretsManager(config.actorCatalogSecretArn, { region: config.awsRegion })
    : loadActorCatalogFromFile(config.actorCatalogPath!);
  logger.info(
    { actors: catalog.list(), source: config.actorCatalogSecretArn ? 'secrets-manager' : 'file' },
    'actor catalog loaded',
  );

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

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const app = await buildApp(config);
  app.listen(config.port, () => logger.info({ port: config.port }, 'token-broker listening'));
}

// Only auto-run main() when this file is executed directly (e.g. `node dist/index.js`).
// Importing the module (e.g. from the boot integration test) must not start the server.
const invokedAsScript = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const url = new URL(`file://${argv1}`).href;
    return import.meta.url === url;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('fatal startup error', err);
    process.exit(1);
  });
}
