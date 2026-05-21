# S2S Identity Stack

[![CI](https://github.com/Ziack/s2s-m2m-identity-stack/actions/workflows/pr.yml/badge.svg)](https://github.com/Ziack/s2s-m2m-identity-stack/actions/workflows/pr.yml)
[![Release](https://img.shields.io/github/v/release/Ziack/s2s-m2m-identity-stack)](https://github.com/Ziack/s2s-m2m-identity-stack/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A drop-in service-to-service identity stack for AWS-hosted Node applications.
One Terraform module deploys the shared platform (Cognito + AVP + Cedar +
DPoP token broker on Fargate). A second module is consumed by each service
to get a hardened Fargate task, an ALB, a per-service Cognito client, IAM
least-privilege, and the platform-injected sidecars — without any way to
weaken the security posture.

```
+--------------------+        +-----------------+        +--------------------+
|  Service A (caller)| -----> | Token broker    | -----> | Service B (callee) |
|  @s2s/auth-library |  DPoP  | RFC 8693 + AVP  |  DPoP  | @s2s/auth-library  |
+--------------------+        +-----------------+        +--------------------+
       (Cognito M2M client)        (Cedar policies)          (Cognito M2M client)
```

## Get started

New project? Follow the 30-minute walkthrough: **[docs/getting-started.md](./docs/getting-started.md)**.

Existing Node app? Use the five-phase guide: **[docs/onboarding-existing-app.md](./docs/onboarding-existing-app.md)**.

Migrating from v1? See **[docs/migration-from-v1.md](./docs/migration-from-v1.md)**.

## Repository layout

| Path | Purpose |
| --- | --- |
| `modules/s2s-platform/` | Terraform module — platform team applies once per account |
| `modules/s2s-service/` | Terraform module — every service consumes this |
| `packages/auth-library/` | `@s2s/auth-library` — runtime SDK (DPoP, token exchange, middleware) |
| `packages/cedar-policies/` | `@s2s/cedar-tooling` — Cedar schema + policy uploader |
| `packages/create-service/` | `@s2s/create-service` — `npm create @s2s/service@latest` |
| `packages/token-broker/` | Token broker source (published as a container to GHCR) |
| `app-template/` | Scaffold copied by the CLI |
| `examples/chained/` | Reference deployment: calling → receiving → ledger |
| `examples/migrations/` | Three worked migration examples (Express, Fastify, Koa) |
| `docs/` | Full documentation set |

## Install snippets

```hcl
# Platform team — once per AWS account
module "s2s_platform" {
  source = "git::https://github.com/Ziack/s2s-m2m-identity-stack.git//modules/s2s-platform?ref=v2.0.0"
  # ...inputs documented in docs/platform-deployment.md
}

# Service team — once per service
module "s2s_service" {
  source = "git::https://github.com/Ziack/s2s-m2m-identity-stack.git//modules/s2s-service?ref=v2.0.0"
  # ...inputs documented in docs/service-deployment.md
}
```

```bash
# Service runtime
npm install @s2s/auth-library@2.0.0

# Policy authoring & deploy
npm install --save-dev @s2s/cedar-tooling@2.0.0

# Scaffold a new service
npm create @s2s/service@latest
```

## Architecture

See [docs/architecture.md](./docs/architecture.md) for diagrams, the token-exchange
sequence, the DPoP-binding model, and how `user` + `actor_chain` context flow
through the AVP authorization decision.

## Contributing

Issues and PRs welcome. Run `npm install && npm test` at the repo root before
opening a PR; CI mirrors the same checks plus `terraform validate` on every
module and every example.

## License

MIT. See [LICENSE](./LICENSE).
