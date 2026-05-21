# Migration: from no-auth (IP-allowlist internal) to S2S v2

This is the simplest migration but also the most behavioural-change-heavy: the app gains an authorization layer it never had. The Cedar policy is the design decision; everything else is mechanical.

Read alongside [`docs/onboarding-existing-app.md`](../../../docs/onboarding-existing-app.md).

## Why no user claims?

Internal services typically receive calls from other services on behalf of nothing — there is no end-user principal. The Cedar policy keys on `context.actor_chain` only. This is the canonical "machine-to-machine internal" pattern.

## What `before/` looks like

```
before/
  src/routes.ts        # 2 routes, no auth
  src/index.ts         # express()
  test/routes.test.ts
  Dockerfile           # OLD: header comment defers to ALB IP allowlist
```

## Phase 1 — Inventory completed

- **App name**: internal
- **Inbound auth**: none in-app (VPC SG + ALB IP allowlist)
- **Outbound calls**: none
- **Authorisation**: none
- **State**: stateless
- **Bounded context**: platform-internal

## Phase 2 — Code adoption

Wire `createBrokerAuthMiddleware({ mode: 'enforce' })` ahead of the `/internal` routes. Routes trust `req.auth.decision`. No legacy auth to delete.

## Phase 3 — Outbound calls

N/A.

## Phase 4 — Container migration

Same eight-row checklist as the other examples; see [`after/Dockerfile`](./after/Dockerfile).

## Phase 5 — Terraform onboarding

```bash
npm create @s2s/service@latest --existing-app .
```

The Cedar policy is the substantive change — see [`after/policies/internal.cedar`](./after/policies/internal.cedar). It keys entirely on `context.actor_chain.contains("platform")`.

## Anti-patterns avoided

- Inventory completed first.
- Shadow mode → enforce, even though there is no legacy auth (the shadow mode logs let the team confirm no caller is denied for chain-shape reasons).

## Running this example yourself

```bash
cd before && npm test
cd ../after && npm test
terraform -chdir=after/terraform init -backend=false && terraform -chdir=after/terraform validate
```

## Effort estimate verification (paper exercise)

Stress-testing the "≤ 1-2 days for a small app" claim from [`docs/onboarding-existing-app.md`](../../../docs/onboarding-existing-app.md) § Effort estimate by enumerating the commits this smallest migration produces:

| Phase | Commit | Estimated hours |
| --- | --- | --- |
| 2a | `chore: add @s2s/auth-library` | 0.5 |
| 2b | `feat: wire shadow-mode broker auth` | 1 |
| 2c | `feat: cut over to enforce mode` | 0.5 |
| 4 | `chore: Dockerfile multi-stage + non-root` | 2 |
| 4 | `feat: /health + /metrics` | 1 |
| 4 | `feat: pino structured logging` | 0.5 |
| 4 | `feat: SIGTERM drain handler` | 1 |
| 5 | `chore: scaffold via npm create @s2s/service --existing-app` | 1 |
| 5 | `feat: author internal.cedar` | 2 |
| 5 | `chore: terraform apply` | 1 |
| 5 | `chore: smoke test + DNS cutover` | 1 |
| **Total** | | **~11.5 working hours = 1.5 dev-days** |

Consistent with the "1-2 days for a small app" table row in `docs/onboarding-existing-app.md` § Effort estimate.
