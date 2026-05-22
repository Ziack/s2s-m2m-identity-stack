import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { URL } from 'node:url';
import { initKeyPair, createJwksManager, createValidateUserToken, applyInsecureTlsEscapeHatch } from '@s2s/auth-library';
import { loadConfig } from './config.js';

// Opt-in, default-OFF TLS escape hatch for the self-signed-cert PoC path.
// No effect unless ALLOW_INSECURE_TLS=true. Production uses a real ACM cert.
applyInsecureTlsEscapeHatch();
import { initAuthClient } from './lib/authClient.js';
import { initExchangeClient } from './lib/exchangeClient.js';
import { createUserAuthMiddleware } from './lib/userAuthMiddleware.js';
import { createUserIssuerKeyLoader } from './auth/userIssuerKeyLoader.js';
import { createLocalIssuer } from './auth/localIssuer.js';
import { authRouter } from './routes/auth.js';
import { syncRouter } from './routes/sync.js';
import { asyncRouter } from './routes/async.js';
import { jwksRouter } from './routes/jwks.js';
import { metricsRouter } from './routes/metrics.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

function issuerPathname(issuer: string): string {
  try {
    const u = new URL(issuer);
    const p = u.pathname.replace(/\/+$/, '');
    return p === '' ? '/auth' : p;
  } catch {
    return '/auth';
  }
}

async function main(): Promise<void> {
  await initKeyPair();
  await initAuthClient(config);
  initExchangeClient(config);

  const keyLoaderOpts: Parameters<typeof createUserIssuerKeyLoader>[0] = {
    region: config.awsRegion,
  };
  if (config.userIssuerSigningKeySecretArn) {
    keyLoaderOpts.secretArn = config.userIssuerSigningKeySecretArn;
  }
  if (config.userIssuerDevKeyPem) {
    keyLoaderOpts.devKeyPem = config.userIssuerDevKeyPem;
  }
  const keyLoader = createUserIssuerKeyLoader(keyLoaderOpts);

  const localIssuer = createLocalIssuer({
    issuer: config.userIssuerUrl,
    audience: config.userIssuerAudience,
    keyLoader,
  });

  const jwksManager = createJwksManager({
    jwksUri: `${config.userIssuerUrl}/.well-known/jwks.json`,
    refreshHours: 1,
  });
  const validate = createValidateUserToken({
    jwksManager,
    expectedIssuer: config.userIssuerUrl,
    expectedAudience: config.userIssuerAudience,
  });

  const app = express();
  app.disable('x-powered-by');
  // Behind the ALB (TLS termination) honor X-Forwarded-Proto so req.protocol
  // reports https — required for the DPoP htu to match the signed https URL.
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));
  app.use(pinoHttp({ logger }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Mount the local IdP router at the path component of USER_ISSUER_URL so
  // that the published `jwks_uri` matches where we serve it. authRouter already
  // serves the user-issuer JWKS at `${authPath}/.well-known/jwks.json`, which is
  // exactly where the broker fetches it (`${USER_ISSUER_URL}/.well-known/jwks.json`).
  const authPath = issuerPathname(config.userIssuerUrl);
  app.use(
    authPath,
    authRouter({
      issuer: config.userIssuerUrl,
      audience: config.userIssuerAudience,
      localIssuer,
      keyLoader,
      isProduction: config.nodeEnv === 'production',
    }),
  );

  // DPoP-key JWKS (process-key, separate from the user issuer above). Mounted
  // under the same `${authPath}` prefix (not root) so it routes through the
  // calling-service's `/auth/*` ALB rule instead of being intercepted by the
  // platform broker's higher-priority `/.well-known/*` listener rule.
  app.use(authPath, jwksRouter());
  app.use(metricsRouter());

  // From here down, routes require a valid user token. The middleware skips
  // /auth, /.well-known, /health, /metrics by default.
  app.use(createUserAuthMiddleware({ validate }));

  app.use('/demo', syncRouter(config));
  app.use('/demo', asyncRouter(config));

  app.listen(config.port, () => logger.info({ port: config.port }, 'calling-service listening'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
