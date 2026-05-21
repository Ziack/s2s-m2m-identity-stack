# s2s-service

Terraform module — one container service in the S2S Identity Stack.

## Purpose

Provisions per-service infrastructure: Cognito app client, client secret in Secrets Manager, ECR repository, IAM execution + task roles, standardised Fargate task definition, ALB target group + listener rule, and Cedar policy injection into the platform's AVP store.

## When to use

Call once per service. Consume the platform via `var.platform` (the composite output from `s2s-platform`, or an equivalent object assembled from SSM lookups in the consumer's TF root).

The module API is **closed by design** (spec §4 decision #10). There is NO input that lets a service team override the task definition, sidecars, IAM, capabilities, log driver, root-fs, or user. To add a service-specific helper container, request a named entry in `s2s-platform/sidecars.tf` from the platform team.

## Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `platform` | object(…) | yes | — | Composite from `module.platform.platform` or SSM-assembled equivalent |
| `service_name` | string | yes | — | Lowercase DNS-safe |
| `bounded_context` | string | yes | — | Must exist in platform `bounded_contexts` |
| `scopes` | list(string) | no | `[]` | Format `<ctx>/<action>` |
| `image_uri` | string | yes | — | Container image |
| `container_port` | number | no | `3000` | |
| `cpu` | number | no | `256` | |
| `memory` | number | no | `512` | |
| `desired_count` | number | no | `2` | |
| `health_check_path` | string | no | `/health` | |
| `log_retention_days` | number | no | `30` | |
| `alb_path_pattern` | string | yes | — | ALB listener-rule match |
| `alb_listener_rule_priority` | number | yes | — | Must be unique per ALB listener |
| `cedar_policies` | list(object) | no | `[]` | `{ name, statement, description? }` |
| `outbound_audiences` | list(string) | no | `[]` | Bounded contexts this service calls |
| `env` | map(string) | no | `{}` | Extra env. Validation REJECTS keys colliding with platform-managed names |
| `tags` | map(string) | no | `{}` | |

## Outputs

| Name | Description |
|---|---|
| `service_url` | `https://<alb_dns_name><path-prefix>` |
| `ecr_repository_uri` | Per-service ECR URI |
| `cognito_client_id` | App client ID |
| `client_secret_arn` | SM secret ARN |
| `task_role_arn` | IAM task role ARN |
| `log_group_name` | CloudWatch log group |
| `task_definition_arn` | Task def ARN |
| `policy_ids` | List of Cedar policy IDs created in the platform's AVP policy store |

## Example

See `examples/basic/` in the repo root for the canonical SSM-assembly pattern.

## Pitfalls

- **Env collisions:** Setting `env = { COGNITO_CLIENT_ID = "..." }` is rejected at plan time. Forbidden keys are listed in the validation error.
- **alb_listener_rule_priority must be unique** across all services attached to the platform's ALB listener.
- **No task-def overrides.** If you need a helper container, request a named sidecar in the platform repo — do not fork this module.
- **Cedar policy churn:** Each `aws_verifiedpermissions_policy` re-creates on edit. Keep policies stable; iterate via additional policies rather than mutation.
