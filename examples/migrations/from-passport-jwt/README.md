# Migration: from passport-jwt to S2S v2

An Express + Passport-JWT app migrated through all five phases. Read this alongside [`docs/onboarding-existing-app.md`](../../../docs/onboarding-existing-app.md) — each section maps to a phase.

## What `before/` looks like

```
before/
  src/auth.ts        # passport-jwt strategy + requireRole helper
  src/downstream.ts  # postLedgerEntry — forwards inbound bearer (legacy)
  src/routes.ts      # 3 routes guarded by requireJwt / requireRole
  src/index.ts       # express() + passport.initialize() — NO /health, NO SIGTERM
  test/routes.test.ts
  Dockerfile         # node:18, root user, root FS writable, no /health
  package.json
```

This app is the *entry point* today — it verifies the local IdP token directly via `passport-jwt`.

## Phase 1 — Inventory completed

Filled-in inventory for this app (snapshot of [`docs/onboarding-checklist.md`](../../../docs/onboarding-checklist.md)):

- **App name**: orders
- **Owning team**: platform-orders
- **Inbound auth**: Bearer JWT (local Cognito user pool, RS256)
- **Outbound calls**: 1 → ledger (currently forwards inbound bearer)
- **Container shape**: runs as root, no `/health`, no SIGTERM, env-var-only secrets
- **Authorisation**: hardcoded role string `'manager'` checked via Express middleware
- **State**: stateless
- **Bounded context**: orders

## Phase 2 — Code adoption (shadow → enforce)

**Diff of `src/auth.ts`:** entire file deleted in `after/`. `passport.authenticate('jwt', ...)` and `requireRole` are gone.

**Diff of `src/index.ts`:**

```diff
- import passport from 'passport';
- import './auth.js';
+ import { createBrokerAuthMiddleware } from '@s2s/auth-library';
+ import { healthRouter } from './health.js';

  const app = express();
  app.use(express.json());
- app.use(passport.initialize());
+ app.use(healthRouter);
+ app.use('/api', createBrokerAuthMiddleware({
+   brokerJwksUri: process.env.BROKER_JWKS_URI!,
+   brokerIssuer: process.env.BROKER_ISSUER!,
+   brokerAudience: process.env.BROKER_AUDIENCE!,
+   policyStoreId: process.env.AVP_POLICY_STORE_ID!,
+   awsRegion: process.env.AWS_REGION!,
+   redisEndpoint: process.env.REDIS_ENDPOINT!,
+   mode: 'enforce',
+   logger,
+ }));
  app.use('/api', ordersRouter);
```

> **Critical shape change.** This app is no longer the entry point — it sits *behind* the calling-service in the chain. The broker has already verified the local IdP token; this service trusts the broker JWT plus actor chain. `req.user` (passport's shape) becomes `req.auth.principal` + `req.auth.actorChain`.

## Phase 3 — Outbound calls

**Diff of `src/downstream.ts`:** forwarding `req.headers.authorization` becomes `createExchangeToken` + `signDPoP` + `withDPoPNonceRetry`.

```diff
- export async function postLedgerEntry(req, payload) {
-   return fetch(LEDGER_URL, {
-     headers: { authorization: req.headers.authorization, ... },
-   });
- }
+ const exchangeForLedger = createExchangeToken({ ...broker config..., audience: 'ledger' });
+ export async function postLedgerEntry(req, payload) {
+   const exchanged = await exchangeForLedger({ subjectToken: ... });
+   return withDPoPNonceRetry(async (nonce) => {
+     const dpop = await signDPoP({ accessToken: exchanged.accessToken, htm: 'POST', htu, nonce });
+     return fetch(htu, { headers: { authorization: `DPoP ${exchanged.accessToken}`, dpop: dpop.proof, ... } });
+   });
+ }
```

## Phase 4 — Container migration

| Check | Before | After |
| --- | --- | --- |
| Run as non-root | runs as root | `USER 1000:1000` |
| Read-only root FS | writable | ECS task def `readonlyRootFilesystem: true` |
| `/health` endpoint | missing | `healthRouter.get('/health', ...)` mounted before auth |
| `/metrics` endpoint | missing | `prom-client` exposed via `healthRouter` |
| Lazy-load secrets | env var | `getClientSecret(arn)` via `@s2s/auth-library` |
| Structured logging | console.log | `pino()` JSON stdout |
| SIGTERM handling | none | drain + 10s hard timeout |
| Standardised Dockerfile | `node:18` single-stage | multi-stage `node:20-alpine` + healthcheck |

## Phase 5 — Terraform onboarding

```bash
cd existing-app/
npm create @s2s/service@latest --existing-app .
```

Generates `terraform/`, `policies/orders.cedar`, `.s2s-config.json`. The Terraform root calls `module "s2s_service"` with `bounded_context = "orders"`, mounting the Cedar policy file. Policies live in [`after/policies/orders.cedar`](./after/policies/orders.cedar).

```bash
cd terraform
terraform init
terraform apply
curl https://$(terraform output -raw service_url)/health  # {"status":"ok"}
```

## Anti-patterns avoided

- One PR per phase: ✓ (commits map 1:1 to phases above).
- Shadow mode used before enforce: ✓ (Phase 2b → 2c).
- Outbound migrated only after `ledger` is on S2S: ✓ (inventoried in Phase 1).
- Dockerfile replaced wholesale in Phase 4: ✓.
- Cedar policies grounded in observed `mode: 'log-only'` logs before enforce: ✓.
- Inventory checklist filled before Phase 2: ✓.

## Running this example yourself

```bash
cd before && npm test
cd ../after && npm test
terraform -chdir=after/terraform init -backend=false && terraform -chdir=after/terraform validate
```
