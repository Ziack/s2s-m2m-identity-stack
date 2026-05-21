# Basic example — `hello-loans`

A single Express service returning `{ok: true}` on `/api/hello`. Demonstrates the minimum surface area needed to deploy through the `s2s-service` module: one Cognito client, one ECR repo, one Cedar policy, one ALB listener rule.

See `./hello-loans/terraform/main.tf` for the module call.

> The loose `examples/basic/{main.tf,variables.tf,outputs.tf,versions.tf,fixtures/}` files at this level are a Plan 1 smoke harness used to validate `modules/s2s-service` in isolation. They remain in place for module-level CI validation; new example application code lives under `hello-loans/`.
