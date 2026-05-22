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
| `alb_path_pattern` | string | conditional | `null` | Single ALB listener-rule path match. Mutually exclusive with `alb_path_patterns` — set exactly one |
| `alb_path_patterns` | list(string) | conditional | `null` | List of ALB path matches (up to 5, OR'd into ONE listener rule). Mutually exclusive with `alb_path_pattern` — set exactly one |
| `alb_listener_rule_priority` | number | yes | — | Must be unique per ALB listener |
| `cedar_policies` | list(object) | no | `[]` | `{ name, statement, description? }` |
| `outbound_audiences` | list(string) | no | `[]` | Bounded contexts this service calls |
| `register_with_lattice` | bool | no | `true` | Register this service with VPC Lattice. Only acts when `platform.enable_lattice` is also true. Set false to opt a single service out (ALB-only) on a Lattice-enabled platform |
| `lattice_allowed_caller_arns` | list(string) | no | `[]` | When non-empty, tightens this service's Lattice auth policy to ONLY these principal (caller task-role) ARNs. When empty, the policy allows any principal in this account |
| `calls_broker` | bool | no | `true` | Whether this service makes outbound SigV4 calls to the broker. Together with `outbound_audiences`, gates the task-role `vpc-lattice-svcs:Invoke` statement |
| `env` | map(string) | no | `{}` | Extra env. Validation REJECTS keys colliding with platform-managed names |
| `tags` | map(string) | no | `{}` | |

The `platform` object also carries the Phase-2 Lattice fields `enable_lattice` (bool, default `false`), `lattice_service_network_id`, and `broker_lattice_dns`. They are optional in the object type, so consumers that assemble `platform` from SSM without them keep validating AND keep Lattice OFF (zero behavior change). The `module.platform.platform` composite output always sets all three.

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
| `lattice_service_dns` | This service's VPC Lattice DNS name; `null` when not registered |
| `lattice_service_arn` | This service's VPC Lattice service ARN (for tightening callers' policies); `null` when not registered |

## VPC Lattice

When the platform has `enable_lattice = true` (Phase 2) and this service keeps the
default `register_with_lattice = true`, the module provisions a per-service Lattice
plane in addition to the ALB. This mirrors the broker's Lattice registration owned
by the platform module.

**Per-service inbound (this module owns):**

- `aws_vpclattice_service` (`<env>-<service>-svc`, `auth_type = AWS_IAM`)
- `aws_vpclattice_service_network_service_association` into the platform's service network
- `aws_vpclattice_target_group` (type `IP`, HTTP, `container_port`, health check `health_check_path`)
- `aws_vpclattice_listener` (HTTP on 80, forwards to the IP target group)
- `aws_vpclattice_auth_policy` (account-scoped allow by default; see below)
- `aws_iam_role` assumed by `ecs.amazonaws.com` for ECS-managed target registration

The ECS service registers its task ENIs into the IP target group via a
`vpc_lattice_configurations` block referencing the registration role, the target
group, and the **named** container port mapping (`<service>-<port>`).

Lattice terminates at the service edge; the container only speaks plain HTTP
internally, so the listener forwards over HTTP.

**Auth policy (network-layer defense-in-depth):** by default the policy allows
`vpc-lattice-svcs:Invoke` from any principal in **this account**
(`aws:PrincipalAccount`). The transport is still SigV4/IAM-authenticated. DPoP +
Cedar provide the real per-request authorization. To tighten, set
`lattice_allowed_caller_arns` to the specific caller task-role ARNs — this replaces
the account-wide condition with explicit Principal ARNs. (A caller publishes its
`task_role_arn` output; the consumer wires it into this list.)

**Outbound (SigV4) model:** the task role is granted `vpc-lattice-svcs:Invoke`
whenever `calls_broker = true` (default — every service exchanges actor
credentials at the broker) or `outbound_audiences` is non-empty. The resource is
scoped to `arn:aws:vpc-lattice:<region>:<account>:service/*` (all Lattice services
in-account) because the exact callee ARNs belong to other s2s-service instances /
the platform broker and aren't available at plan time. **Tightening path:** once a
callee publishes its `lattice_service_arn` output, the consumer can replace the
wildcard with specific ARNs.

**Opt-out:** set `register_with_lattice = false` to leave a single service ALB-only
even on a Lattice-enabled platform. When the platform has Lattice **disabled**,
this module creates zero Lattice resources regardless of `register_with_lattice`.

The `lattice_service_dns` / `lattice_service_arn` outputs are `null` when the
service is not registered.

## DPoP sender-constraint (cnf.jkt)

As of **v2.2.0**, receivers **hard-enforce** the DPoP `cnf.jkt` sender-constraint
(RFC 9449 §5–6). The broker mints each service token with `cnf: { jkt }` bound to
the holder's exchange-proof key; the receiving SDK middleware requires the
request's DPoP-proof key thumbprint to equal the token's `cnf.jkt` or returns
`401 dpop_key_mismatch`. Services scaffolded by `@s2s/create-service` get
`requireCnfBinding` defaulting to **true**. The cnf check only applies when DPoP
is enabled (`requireDPoP`); with DPoP off it is inert. See
[architecture.md](../../docs/architecture.md#dpop-sender-constraint-cnfjkt) for
the full bind/re-bind flow.

## Example

See `examples/basic/` in the repo root for the canonical SSM-assembly pattern.

## Pitfalls

- **Env collisions:** Setting `env = { COGNITO_CLIENT_ID = "..." }` is rejected at plan time. Forbidden keys are listed in the validation error.
- **alb_listener_rule_priority must be unique** across all services attached to the platform's ALB listener.
- **No task-def overrides.** If you need a helper container, request a named sidecar in the platform repo — do not fork this module.
- **Cedar policy churn:** Each `aws_verifiedpermissions_policy` re-creates on edit. Keep policies stable; iterate via additional policies rather than mutation.
