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

_To be filled in subsequent task._

## Phase 4 — Container migration

_To be filled in subsequent task._

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
