# Changelog

All notable changes to the S2S Identity Stack are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

A single version line covers every artifact in the repo (see §9.1 of the design spec):
- `modules/s2s-platform/` (Terraform module, pinned via `?ref=v<tag>`)
- `modules/s2s-service/` (Terraform module, pinned via `?ref=v<tag>`)
- `@s2s/auth-library` (npm)
- `@s2s/cedar-tooling` (npm)
- `@s2s/create-service` (npm)
- `ghcr.io/ziack/s2s-token-broker:v<tag>` (container)

## [Unreleased]

(Nothing yet.)

## [2.0.2] — 2026-05-21

Closes the **deploy-story gap** identified after v2.0.1: until this
release, there was no standalone Terraform root that deployed
`modules/s2s-platform` (every example called `s2s-service` and assumed the
platform already existed), and the chained-example orchestrator script
still referenced v1 paths that had been deleted in v2.0.0.

### Added

- `examples/_platform/` — deployable platform root. Wraps
  `modules/s2s-platform` in a thin `module "platform"` block, exposes every
  output, and ships a `fixtures/dev.tfvars.json.example` template. The
  underscore prefix sorts it to the top of `examples/` and signals
  "infrastructure, not a service example". See
  `examples/_platform/README.md`.
- `docs/deploying-the-stack.md` — end-to-end operator walkthrough from
  clone to deployed: prerequisites, platform apply, image build/push, per-
  service apply, actor-catalog bootstrap, smoke test, and a full
  RETAIN-policy cleanup runbook for teardown.

### Fixed

- `examples/chained/e2e/src/scripts/deploy-and-test.sh` — rewritten for
  the v2 layout. Replaced stale paths (`infrastructure/terraform/`,
  `packages/examples/calling-service/Dockerfile`, the `@s2s/calling-service`
  workspace) with the current ones (`examples/_platform/`,
  `examples/chained/<svc>/Dockerfile`,
  `examples/chained/<svc>/terraform/`, broker at
  `packages/token-broker/Dockerfile`). Added a `teardown` subcommand that
  destroys services first, then the platform. Documented the actor-catalog
  bootstrap step as a known gap pending a future platform-module
  enhancement.

### Known limitations

- The `s2s-platform` module does not yet provision the broker's
  `actor-catalog` Secrets Manager secret. The orchestrator script and
  `docs/deploying-the-stack.md` §7 create it manually on first deploy and
  force a broker redeploy. Folding this into the module is tracked for a
  future release.

## [2.0.1] — 2026-05-21

### Removed

- `modules/s2s-platform` — dead `enable_hybrid_broker` and `hybrid_broker_onprem_cidr` variables. They were declared but never consumed by any resource; setting them did nothing in v2.0.0. The hybrid-broker capability (mTLS-terminating translator for on-premise callers) is reserved for a future **separate sibling module** `modules/s2s-hybrid-broker/`, not a flag on `s2s-platform`. This keeps the heavy Network Hub VPC + Site-to-Site VPN + ECS infra opt-in deliberately.

### Documentation

- `modules/s2s-platform/README.md` — added "On-premise / hybrid callers" section explaining the planned sibling-module approach and pointing at the `v1.0.0` tag for the reference implementation
- `docs/migration-from-v1.md` — clarified that v1's `hybrid_broker` does NOT migrate via `moved {}` blocks; consumers either keep the v1 deployment running independently or wait for the future sibling module
- `docs/platform-deployment.md` — removed dead-variable row from the inputs table

This is a **minor breaking** change only for anyone who explicitly set `enable_hybrid_broker = true` in v2.0.0 (which had no effect anyway). No state migration required.

## [2.0.0] — 2026-05-21

First release of the modularised platform/service split. **This is a breaking
change from v1.x.x.** Existing v1 deployments should stay pinned to the v1 tag
(see "v1 users" below); new deployments adopt v2 from scratch.

### Breaking changes

- Repo layout rewritten. `infrastructure/terraform/` is deleted. Two
  consumer-facing Terraform modules now live at `modules/s2s-platform/` and
  `modules/s2s-service/`. Both are consumed by `source = "git::…?ref=v2.0.0"`.
- `@s2s/auth-library` v2 ships `createBrokerAuthMiddleware({ mode: 'log-only' | 'enforce' })`
  alongside the v1 `createAuthMiddleware`. The v1 middleware is still exported
  for backwards-compat within a single major; v3 will remove it.
- Cedar schema gained two top-level context fields: `user` (the human principal
  attribute set) and `actor_chain` (the ordered list of upstream service
  principals). Policies that previously referenced `context.client_id` must
  migrate to `context.actor_chain[0].client_id`. See `docs/cedar-authoring.md`
  §"Migrating v1 policies".
- Broker container image moved from internal ECR to GHCR:
  `ghcr.io/ziack/s2s-token-broker:v2.0.0`. v1 image tags are not republished.
- The example services (`calling`, `receiving`, `ledger`) were rewritten as
  reference Terraform roots under `examples/chained/`. The v1 example sources
  in `packages/examples/{calling,receiving,ledger}-service/` are deleted.
- The v1 end-to-end harness in `packages/e2e/` is deleted; equivalent coverage
  lives in `examples/chained/e2e/`.

### Added

- `modules/s2s-platform/` — single-apply platform module: Cognito user pool,
  AVP policy stores keyed by bounded context, Valkey/ElastiCache, KMS CMK,
  broker ECS service, JWKS endpoint, optional VPC Lattice, optional hybrid
  broker for cross-cloud workloads. (Plan 1.)
- `modules/s2s-service/` — service-team-facing module: Fargate task, ALB,
  IAM task-role with least-privilege, per-service Cognito app client +
  secret in Secrets Manager, per-service ECR repo, AVP policy attachment,
  the platform-injected sidecar set. Service teams cannot override any
  hardening input. (Plan 2.)
- `packages/create-service/` — `npm create @s2s/service@latest` interactive
  CLI scaffolding a service repo with: TF root calling `module "s2s_service"`,
  Dockerfile, source skeleton wired to `@s2s/auth-library`, Vitest harness,
  CI workflow, README. Supports `--non-interactive --config=<json>` for
  unattended use. (Plan 3.)
- `examples/chained/` — reference deployment of three services
  (calling → receiving → ledger) demonstrating the RFC 8693 token-exchange
  chain end-to-end with `user` + `actor_chain` context propagation. (Plan 3.)
- `examples/migrations/` — three worked migration examples for existing
  Express/Fastify/Koa apps (Plan 3, paired with `docs/onboarding-existing-app.md`).
- `@s2s/cedar-tooling` — Cedar schema bundler + policy linter + AVP uploader.
  Ships the v2 schema. (Plan 4.)
- `createBrokerAuthMiddleware({ mode })` in `@s2s/auth-library` — shadow-mode
  (`log-only`) for incremental rollouts, hard-enforce (`enforce`) for
  steady-state. (Plan 2 + Plan 4.)
- `docs/onboarding-existing-app.md` — the five-phase migration guide for
  existing Node apps (Plan 3).
- `docs/architecture.md`, `docs/getting-started.md`, `docs/platform-deployment.md`,
  `docs/service-deployment.md`, `docs/cedar-authoring.md`,
  `docs/migration-from-v1.md` — full v2 documentation set.
- CI workflows `.github/workflows/{pr,release,security}.yml`.

### Changed

- Single repo-wide semver line. Each tag simultaneously versions both TF
  modules, all `@s2s/*` packages, and the broker container.
- AWS provider pinned to `~> 5.60` (was `~> 5.30`). Terraform pinned to `~> 1.8`.

### Removed

- `infrastructure/terraform/` (entirely).
- `packages/examples/calling-service/`, `receiving-service/`, `ledger-service/`.
- `packages/e2e/` (replaced by `examples/chained/e2e/`).
- `packages/services/token-broker/` (source moved to `packages/token-broker/`).

### Migration

- New deployments: follow `docs/getting-started.md`.
- Existing v1 deployments: choose one of two paths:
  1. Stay on v1 (recommended for stable production until v2.1). Pin module
     sources to `?ref=v1.0.0`. v1 is in maintenance — critical security
     fixes only.
  2. In-place migrate to v2: follow `docs/migration-from-v1.md`. Use the
     documented `moved {}` blocks to rename state without destroy/recreate.

### v1 users

The v1 line is preserved at its final tag. Browse the v1 source at
[Ziack/s2s-m2m-identity-stack @ v1.0.0](https://github.com/Ziack/s2s-m2m-identity-stack/tree/v1.0.0).
Pin module sources to `?ref=v1.0.0` to stay on the old line. v1 docs at
[/tree/v1.0.0/README.md](https://github.com/Ziack/s2s-m2m-identity-stack/blob/v1.0.0/README.md).

[Unreleased]: https://github.com/Ziack/s2s-m2m-identity-stack/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Ziack/s2s-m2m-identity-stack/releases/tag/v2.0.0
