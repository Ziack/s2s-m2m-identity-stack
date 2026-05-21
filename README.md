# S2S Identity Stack v2

Service-to-service identity, DPoP-bound tokens, and Cedar-based authorization for AWS workloads.

## Migrating an existing service?

See [docs/onboarding-existing-app.md](docs/onboarding-existing-app.md) — five phases, three worked examples, an inventory checklist, and an RBAC→Cedar translation appendix.

## Worked examples

- [`examples/basic/`](examples/basic/) — minimal hello-loans
- [`examples/chained/`](examples/chained/) — chained context (originator → ledger)
- [`examples/multi-context/`](examples/multi-context/) — multi-context (loan origination + servicing)
- [`examples/migrations/`](examples/migrations/) — three before/after migrations

## Modules

- `modules/s2s-platform/` — bootstraps Cognito user pool, AVP policy stores, broker, Redis, ALB
- `modules/s2s-service/` — per-service ECS Fargate + Cedar policy upload + ALB listener rule

## Packages

- `packages/auth-library/` — `@s2s/auth-library` SDK (DPoP, broker middleware, token exchange, Cedar local)
- `packages/create-service/` — `npm create @s2s/service@latest` scaffolder
