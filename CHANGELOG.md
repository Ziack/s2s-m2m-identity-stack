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

## [2.1.1] — 2026-05-21

Fixes the **calling-service user-facing ALB ingress**. These two bugs were diagnosed alongside the v2.1.0 Dockerfile fix but were missed in that release — v2.1.0 made the broker reachable and fixed the image builds, but the calling-service's own user-facing routes still 404'd or were intercepted.

### Fixed

- **calling-service `/demo/*`, `/health`, `/metrics` returned 404.** `modules/s2s-service`'s ALB listener rule accepted only a single `alb_path_pattern` (string), and calling-service passed only `/auth/*`. The other route families fell through to the ALB's default 404 — so `POST /demo/sync` never reached the service. The module now also accepts `alb_path_patterns` (`list(string)`, up to 5 values OR'd into one listener rule). calling-service routes `["/auth/*", "/demo/*", "/health", "/metrics"]`. Backward-compatible: `alb_path_pattern` (string) still works; exactly one of the two must be set (validated). receiving (`/api/loans*`) and ledger (`/api/ledger*`) keep the string form. Only the user-facing calling-service exposes `/health` + `/metrics` via the shared listener to avoid overlapping `/health` rules across services.
- **calling-service user-issuer JWKS was unreachable.** It was mounted at root `/.well-known/jwks.json`, which the platform broker's higher-priority `/.well-known/*` listener rule intercepts. It now mounts under the IdP path (`${authPath}/.well-known/jwks.json`, i.e. `/auth/.well-known/jwks.json`), reachable via the calling-service's `/auth/*` rule and matching where the broker fetches it (`${USER_ISSUER_URL}/.well-known/jwks.json`).

### Added

- `modules/s2s-service/tests/alb_path_patterns.tftest.hcl` — asserts the list form populates the listener rule's `path_pattern.values`, and that providing neither / both fails validation. Guards against this drift recurring.

### Note

The earlier "502 on `/health`" symptom was a no-healthy-target 502 caused by the pre-v2.1.0 Dockerfile build failures (no image → empty target group). With v2.1.0's Dockerfile fix + this release's listener rule, `/health` now routes to a healthy calling-service task and returns 200.

## [2.1.0] — 2026-05-21

Adds **VPC Lattice** as an opt-in service-to-service transport. When
`enable_lattice = true`, the service→service ("data plane") network hops move
from the ALB to VPC Lattice authenticated with **SigV4 IAM**, while the broker
token-exchange ("control plane") stays on the ALB with `client_secret_basic`.
This is a **minor** release: the feature is additive and gated, defaulting OFF,
so existing deployments are byte-for-byte unchanged. Also repairs the three
chained-service Dockerfiles that have referenced deleted paths since v2.0.0.

### Added

- **VPC Lattice service-to-service transport** (`enable_lattice`, default
  `false`). `modules/s2s-platform` provisions the Lattice service network + the
  broker Lattice service and publishes `lattice_service_network_id` /
  `broker_lattice_dns` to SSM. `modules/s2s-service` registers each service with
  the network (Lattice service + target group + listener + auth policy), exposes
  `lattice_service_dns` / `lattice_service_arn` outputs, and grants the task role
  `vpc-lattice-svcs:Invoke` for its `outbound_audiences`.
- `@s2s/auth-library` `createLatticeFetch` — a SigV4-signing `fetch`-shaped
  client for the Lattice data plane, plus the `DPOP_TOKEN_HEADER`
  (`X-DPoP-Token`) constant.
- `X-DPoP-Token` header support in the broker-aware middleware, so a DPoP-bound
  access token can travel alongside a SigV4 `Authorization` header.
- Chained example terraform: per-service Lattice DNS publish/consume via SSM and
  `USE_LATTICE` / `*_LATTICE_DNS` task-env auto-threading when
  `enable_lattice = true`.

### Fixed

- Three chained-service Dockerfiles (`examples/chained/{calling,receiving,ledger}-service/Dockerfile`)
  referenced deleted `packages/examples/*` paths — broken since the v2.0.0
  example reorg, which silently broke **all three** service image builds. They
  now point at `examples/chained/*`.

### Changed

- The broker-aware middleware reads the DPoP-bound access token from
  `X-DPoP-Token` **first**, falling back to `Authorization: DPoP <token>`. Fully
  backward-compatible — the ALB path is unchanged.

### Architecture

- **Control-plane / data-plane split.** SigV4 and the actor's
  `client_secret_basic` both claim the `Authorization` header and cannot share a
  request, so the broker token-exchange (control plane) stays on the broker ALB
  with `client_secret_basic` in **both** Lattice and non-Lattice modes; only the
  service→service hops (data plane) ride Lattice + SigV4. Under Lattice the
  header model is: SigV4 → `Authorization`, DPoP access token → `X-DPoP-Token`,
  DPoP proof → `DPoP`. See
  [docs/architecture.md](./docs/architecture.md#vpc-lattice-service-to-service-opt-in).

### Migration

- `enable_lattice` defaults to `false`, so **no change is required** for existing
  deployments — the v2.0.4 ALB behavior is preserved exactly. To opt in, follow
  the "Enabling VPC Lattice" subsection of
  [docs/deploying-the-stack.md](./docs/deploying-the-stack.md). Note the
  Lattice-mode apply order is **ledger → receiving → calling** (callers read
  callees' published Lattice DNS from SSM at plan time).

## [2.0.4] — 2026-05-21

Closes a **five-bug env-var contract gap** between
`modules/s2s-platform/broker.tf` and the token-broker container code
that has been silently breaking every deploy from v2.0.0 onward — the
broker has never actually started successfully on a fresh apply. Also
provisions the broker's actor-catalog secret with Terraform (no longer
manual bootstrap) and adds the missing boot test that ties the TF
env-var contract to the broker's `loadConfig()`, so this class of bug
fails CI from now on.

### Fixed

- `modules/s2s-platform/broker.tf` — wire `BROKER_ISSUER_URL` as a
  container env var. `packages/token-broker/src/config.ts:47` does
  `requireEnv('BROKER_ISSUER_URL')` and was crashing on boot.
- `modules/s2s-platform/broker.tf` — pass
  `BROKER_SIGNING_KEY_SECRET_ARN` as an **env var** (the ARN string),
  not via ECS `secrets[]` injection of the secret **value**. The broker
  fetches its own signing-key secret via `signingKeyLoader` /
  `getClientSecret(arn)` so in-process caching and TTL-driven rotation
  work; ECS-injected secret values defeat both.
- `modules/s2s-platform/broker.tf` — health check path is `/health`
  (was `/healthz`). The broker only serves `/health` (and
  `/health/auth`). Fixed in both the container `healthCheck.command`
  and the target group's `health_check.path`.
- `modules/s2s-platform/broker.tf` — pin `PORT=8080` via env var so
  the broker's listener matches the task-definition `portMappings.containerPort`.
  `config.ts:55` defaulted `PORT` to 3000 when unset, leaving the ALB
  target unreachable.
- `modules/s2s-platform/broker.tf` — set `ACTOR_CATALOG_SECRET_ARN`.
  `config.ts:51` throws on boot if neither `ACTOR_CATALOG_PATH` nor
  `ACTOR_CATALOG_SECRET_ARN` is set.

### Added

- `modules/s2s-platform/secrets.tf` — provision the actor-catalog
  Secrets Manager secret as a TF resource (`broker_actor_catalog`)
  with an empty `{}` placeholder body and
  `lifecycle.ignore_changes = [secret_string]` so the orchestrator's
  manual updates to the body don't fight TF. The broker boots
  successfully on first apply and only starts accepting token-exchange
  requests after the orchestrator's step 6 populates real hashes.
- `modules/s2s-platform/outputs.tf` + `ssm.tf` —
  `actor_catalog_secret_arn` output, mirrored to
  `/<env>/s2s/platform/actor_catalog_secret_arn` per the existing
  convention.
- `modules/s2s-platform/broker.tf` — broker task role's
  `GetSecretValue` policy now also covers the actor-catalog secret ARN.
- `packages/token-broker/src/index.ts` — export `buildApp(config)`
  extracted from `main()` so the new boot test can build the Express
  app without binding a port. The `import.meta.url`-vs-`argv[1]` guard
  preserves direct-execution behavior for `node dist/index.js`.
- `packages/token-broker/test/boot.integration.test.ts` — new vitest
  test that drives the broker through a fixture mirroring broker.tf's
  `environment[]` array, asserts `loadConfig()` returns a valid
  config, and exercises `/health` end-to-end via supertest. Any future
  TF env-var change that breaks the contract now fails CI. Broker test
  count: 25 → 28; workspace total: 389 → 392.

### Changed

- `examples/chained/e2e/src/scripts/deploy-and-test.sh` — step 6 now
  uses `aws secretsmanager put-secret-value` unconditionally (the
  secret is guaranteed to exist via TF). The describe-then-create-or-
  update dance is gone.

### Documentation

- `docs/deploying-the-stack.md` §7 — clarifies that the catalog secret
  is provisioned by Terraform; the operator just overwrites the body.
- `modules/s2s-platform/README.md` — `actor_catalog_secret_arn` row
  added to the outputs table.

### Migration

Anyone on v2.0.0 – v2.0.3 must apply v2.0.4. **The broker has never
actually booted on those versions** (bugs 1, 2, and 5 each kill the
process before `app.listen()`). Re-applying the v2.0.4 platform module
will update the broker task definition, create the new
`broker_actor_catalog` secret, and force a new broker deployment with
the corrected task definition. After the platform apply, re-run the
orchestrator (or your equivalent of step 6) to populate the catalog
body, then force a broker redeploy to load the new catalog.

Only fresh deployments are affected — no production caller has ever
held a broker-minted token on v2.0.0–v2.0.3 because the broker never
booted. No data migration is required.

## [2.0.3] — 2026-05-21

Adds the **last missing piece of the turnkey deploy story**: a tiny VPC
root operators can run in an empty sandbox account before
`examples/_platform/`. Until this release, the deploy walkthrough assumed
the operator already had a VPC with private subnets in two AZs — fine in
real orgs, awkward in fresh PoC accounts.

### Added

- `examples/_bootstrap/` — second Terraform root, parallel to
  `examples/_platform/`. Creates a minimal VPC (`10.0.0.0/16` by default),
  two public + two private `/20` subnets across two AZs, IGW, single-AZ
  NAT, and the matching route tables. Outputs a `next_steps` JSON blob
  that pastes directly into the platform fixture's `vpc_id` /
  `private_subnet_ids` / `alb_subnet_ids` fields. Explicitly PoC-grade —
  single-AZ NAT is a documented SPOF, no flow logs, no VPC endpoints, no
  multi-AZ HA. Real prod deployments continue to bring their own VPC and
  skip this root entirely. See `examples/_bootstrap/README.md`.

### Documentation

- `docs/deploying-the-stack.md` — new **Step 0a — Provision a VPC for dev
  (optional)** section, inserted before the existing platform fixture
  step. Shows the `tofu output -json next_steps | jq` snippet for handing
  IDs off to `_platform/`.
- `examples/_platform/README.md` — added a **Prerequisites** callout near
  the top pointing at `examples/_bootstrap/` for operators without an
  existing VPC.

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
