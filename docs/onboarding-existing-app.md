# Onboarding an existing Node app to S2S v2

This guide walks an existing Express/Fastify/Koa app through five phases. Each phase ships as an independent PR and is reverted independently if it goes wrong.

## Phase 1 — Inventory

_To be filled in subsequent task._

## Phase 2 — Code adoption

### 2a — Add the SDK dependency

```bash
npm install @s2s/auth-library@<v1.0 pinned version>
```

No code changes yet. Verify build still works. Commit.

### 2b — Wire inbound auth in shadow mode

```ts
import { createBrokerAuthMiddleware } from '@s2s/auth-library';
import { legacyAuthMiddleware } from './legacy-auth.js';

app.use('/api', createBrokerAuthMiddleware({
  brokerJwksUri: process.env.BROKER_JWKS_URI!,
  brokerIssuer: process.env.BROKER_ISSUER!,
  brokerAudience: process.env.BROKER_AUDIENCE!,
  policyStoreId: process.env.AVP_POLICY_STORE_ID!,
  mode: 'log-only',
}));
app.use('/api', legacyAuthMiddleware);
```

The middleware validates any DPoP-bound broker tokens it sees, logs the decision (with `user.sub`, `actor_chain`, `decision`), and lets the request flow through to legacy auth. This gives the team a release cycle to measure real traffic shape, observe denial rates, and reconcile Cedar policy gaps before enforcement.

> **SDK contract (Plan 2):** `createBrokerAuthMiddleware` accepts `mode: 'log-only' | 'enforce'`. In `log-only` mode, the middleware never short-circuits — it always calls `next()` regardless of decision. Decisions are emitted as `pino` info logs and incremented on the `s2s_broker_decision_total` counter labelled `mode='shadow', decision='allow'|'deny'`. See `packages/auth-library/test/middleware/shadow-mode.test.ts` for the verified behaviour.

### 2c — Cut over to enforcement

```ts
app.use('/api', createBrokerAuthMiddleware({
  // ...same config...
  mode: 'enforce',
}));
// Delete the legacy auth middleware.
```

**Acceptance criteria.** Phase 2 complete when (1) all existing integration tests pass under enforce mode and (2) legacy auth code is deleted.

## Phase 3 — Outbound calls

For each downstream the app currently calls, follow these three steps. Skip this phase if the app has no outbound calls.

**1. Identify the target's `bounded_context`.** The platform team maintains the registry of bounded contexts. Find the downstream's entry; if it is not yet on S2S, defer migration of this outbound call until it is.

**2. Replace the existing auth with the SDK's exchange flow.**

```ts
import { createExchangeToken, signDPoP, getClientSecret } from '@s2s/auth-library';

const exchangeForLedger = createExchangeToken({
  brokerUrl: process.env.BROKER_TOKEN_ENDPOINT!,
  actorClientId: process.env.COGNITO_CLIENT_ID!,
  actorClientSecret: () => getClientSecret(process.env.COGNITO_CLIENT_SECRET_ARN!),
  audience: 'ledger',
  scope: ['ledger/write'],
});

const exchanged = await exchangeForLedger({
  subjectToken: req.headers.authorization!.split(' ')[1],
});

const dpop = await signDPoP({
  accessToken: exchanged.accessToken,
  htm: 'POST',
  htu: `${config.LEDGER_URL}/api/ledger/entries`,
});

await fetch(`${config.LEDGER_URL}/api/ledger/entries`, {
  method: 'POST',
  headers: {
    authorization: `DPoP ${exchanged.accessToken}`,
    dpop: dpop.proof,
    'content-type': 'application/json',
  },
  body: JSON.stringify(payload),
});
```

**3. Wrap with `withDPoPNonceRetry`.** The downstream server may require a server-issued DPoP nonce. The wrapper retries exactly once when the server replies with `WWW-Authenticate: DPoP nonce=...`.

```ts
import { withDPoPNonceRetry } from '@s2s/auth-library';

return withDPoPNonceRetry(async (nonce) => {
  const dpop = await signDPoP({
    accessToken: exchanged.accessToken,
    htm: 'POST',
    htu: `${config.LEDGER_URL}/api/ledger/entries`,
    nonce,
  });
  return fetch(`${config.LEDGER_URL}/api/ledger/entries`, {
    method: 'POST',
    headers: {
      authorization: `DPoP ${exchanged.accessToken}`,
      dpop: dpop.proof,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
});
```

If the downstream is on S2S already, this is a drop-in replacement. If it isn't, keep both code paths behind a feature flag and revisit after target onboarding — don't get stuck in dual-mode forever (see anti-patterns).

**Acceptance criteria.** Phase 3 complete when (1) every outbound call uses `createExchangeToken` + `signDPoP` + `withDPoPNonceRetry`, (2) no bespoke per-target auth code remains, and (3) integration tests against the downstream still pass.

## Phase 4 — Container migration

Most existing Node apps fail one or more of these eight standardised checks. Address each before Phase 5; the task definition the platform module renders assumes this shape.

### 4.1 Run as non-root

```dockerfile
RUN addgroup -g 1000 app && adduser -u 1000 -G app -s /bin/sh -D app
USER 1000:1000
```

Before switching `USER`, ensure the app directory is owned by the new uid: `RUN chown -R 1000:1000 /app`.

### 4.2 Read-only root filesystem

In the ECS task definition: `readonlyRootFilesystem: true`. App-side, refactor any disk writes to `/tmp` (mount an `emptyDir`/`tmpfs` volume) and remove file-cache-on-disk patterns.

### 4.3 `/health` endpoint

```ts
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
```

Place this before any auth middleware so the ALB target group check is unauthenticated.

### 4.4 `/metrics` endpoint

```ts
import client from 'prom-client';
client.collectDefaultMetrics();
app.get('/metrics', async (_req, res) => {
  res.type(client.register.contentType);
  res.send(await client.register.metrics());
});
```

### 4.5 Lazy-load secrets

```ts
import { getClientSecret } from '@s2s/auth-library';
const secret = await getClientSecret(process.env.COGNITO_CLIENT_SECRET_ARN);
```

Do NOT export `client_secret` as a plain env var in the task definition.

### 4.6 Structured logging

```ts
import pino from 'pino';
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
```

`pino` defaults to stdout; CloudWatch Logs picks that up via the task's `awslogs` driver.

### 4.7 SIGTERM handling

```ts
const server = app.listen(port);
process.on('SIGTERM', () => {
  logger.info('SIGTERM received; draining');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
```

### 4.8 Replace Dockerfile

Replace your Dockerfile with the standardised multi-stage `node:20-alpine` template from `packages/create-service/template/Dockerfile`. The worked examples under `examples/migrations/*/after/Dockerfile` show the result.

**Acceptance criteria.** Phase 4 complete when (1) container runs as uid 1000, (2) image starts under `readonlyRootFilesystem: true`, (3) `/health` and `/metrics` return 200, (4) no `client_secret` appears in `env`, (5) SIGTERM triggers a clean drain within 10s.

## Phase 5 — Terraform onboarding

_To be filled in subsequent task._

## Anti-patterns

_To be filled in subsequent task._

## Effort estimate

_To be filled in subsequent task._

## What this guide ships

_To be filled in subsequent task._

## Worked examples

- [examples/migrations/from-passport-jwt/](../examples/migrations/from-passport-jwt/)
- [examples/migrations/from-casbin-rbac/](../examples/migrations/from-casbin-rbac/)
- [examples/migrations/from-no-auth/](../examples/migrations/from-no-auth/)

## See also

- [onboarding-checklist.md](./onboarding-checklist.md)
- [cedar-rbac-translation.md](./cedar-rbac-translation.md)
