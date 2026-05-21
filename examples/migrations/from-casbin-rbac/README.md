# Migration: from casbin RBAC to S2S v2

An Express + Casbin RBAC app translated to Cedar policies on AVP. Read alongside [`docs/onboarding-existing-app.md`](../../../docs/onboarding-existing-app.md) and [`docs/cedar-rbac-translation.md`](../../../docs/cedar-rbac-translation.md) §2.

## What `before/` looks like

```
before/
  casbin/model.conf        # request/policy/role/matcher definitions
  casbin/policy.csv        # 4 p-rules + 2 g-bindings
  src/routes.ts            # 3 routes, each calls enforcer.enforce(sub, obj, act)
  src/index.ts             # express() + reportsRouter
  test/routes.test.ts      # x-user-id header drives the toy "auth"
  Dockerfile               # OLD: node:18, root, no /health
```

## Phase 1 — Inventory completed

- **App name**: reports
- **Inbound auth**: trusted `x-user-id` header (would be IdP token in real life)
- **Outbound calls**: none
- **Authorisation**: Casbin (model + policy.csv files, RBAC with role grouping)
- **State**: stateless (Casbin enforcer in-memory)
- **Bounded context**: reports

## Casbin → Cedar translation

| Casbin `policy.csv` row | Cedar `permit` statement |
| --- | --- |
| `p, analyst, /reports, read` | `permit ( principal, action == Action::"readReports", resource ) when { context.user.roles.contains("analyst") || context.user.roles.contains("admin") };` |
| `p, admin, /reports, read` | (folded into the row above via `\|\|`) |
| `p, admin, /reports, write` | `permit ( principal, action == Action::"writeReports", resource ) when { context.user.roles.contains("admin") };` |
| `p, admin, /reports/:id, delete` | `permit ( principal, action == Action::"deleteReport", resource ) when { context.user.roles.contains("admin") };` |
| `g, alice, analyst` / `g, bob, admin` | Implicit in the IdP token's `user.roles` claim. No Cedar equivalent — the broker propagates the claim into `context.user.roles`. |

Casbin's `g` role grouping is represented in Cedar by the broker token's `user.roles` claim — set in the local IdP, then propagated through the broker into `context.user.roles`. Casbin's runtime role lookup becomes a static claim. See [`cedar-rbac-translation.md`](../../../docs/cedar-rbac-translation.md) §2.

## Phase 2 — Code adoption

Delete `casbin/` directory, delete `enforce()` middleware. `createBrokerAuthMiddleware` enforces; route handlers trust `req.auth.decision`.

## Phase 3 — Outbound calls

N/A — no outbound calls in this example.

## Phase 4 — Container migration

Same eight-row checklist as the from-passport-jwt example. See [`after/Dockerfile`](./after/Dockerfile).

## Phase 5 — Terraform onboarding

```bash
cd existing-app/
npm create @s2s/service@latest --existing-app .
```

`terraform/main.tf` mounts `policies/reports.cedar` via the `cedar_policies` input on `module "s2s_service"`.

## Anti-patterns avoided

- Cedar policies authored from real policy.csv (grounded in observed traffic, not vacuum).
- One PR per phase. Casbin removal is its own PR.
- Inventory checklist filled before Phase 2.

## Running this example yourself

```bash
cd before && npm test
cd ../after && npm test
terraform -chdir=after/terraform init -backend=false && terraform -chdir=after/terraform validate
```
