# s2s-platform

Terraform module — the S2S Identity Stack platform plane.

## Purpose

Provisions the platform-side identity infrastructure for the S2S Identity Stack: Cognito user pool, per-bounded-context AVP policy stores, the token broker (Fargate behind an internal ALB), KMS CMKs, Valkey serverless cache, ECS cluster, and SSM parameter publication of all outputs.

Deployed ONCE per environment (typically per AWS account). Consumed by N invocations of the companion `s2s-service` module.

## When to use

- Standing up the S2S Identity Stack in a new environment.
- Adding a new bounded context (re-apply with extended `bounded_contexts`).
- Rotating broker signing keys (every `broker_signing_key_rotation_days`).
- Bumping the broker container image to a new tag.

Do NOT use this module for per-service config — that belongs in `s2s-service`.

## Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `region` | string | yes | — | AWS region |
| `account_id` | string | yes | — | 12-digit AWS account ID |
| `environment` | string | yes | — | Name prefix (dev/staging/prod) |
| `vpc_id` | string | yes | — | VPC (not created here) |
| `private_subnet_ids` | list(string) | yes | — | Private subnets for ECS + cache |
| `alb_subnet_ids` | list(string) | yes | — | ALB subnets |
| `internal_alb` | bool | no | `true` | Internal vs internet-facing ALB |
| `bounded_contexts` | list(string) | no | `[]` | Domain taxonomy |
| `user_issuer_url` | string | yes | — | User IdP issuer URL (the Keycloak swap target) |
| `user_issuer_audience` | string | no | `"platform"` | Audience claim expected on user JWTs |
| `broker_image_uri` | string | yes | — | Broker container image |
| `broker_desired_count` | number | no | `2` | Number of broker tasks |
| `broker_signing_key_rotation_days` | number | no | `90` | Rotation cadence |
| `broker_log_retention_days` | number | no | `30` | CloudWatch retention for broker logs |
| `cognito_domain_prefix` | string | yes | — | **Globally unique** Cognito hosted domain |
| `enable_lattice` | bool | no | `false` | Reserved for v2.x |
| `tags` | map(string) | no | `{}` | Tags merged onto every resource |

## On-premise / hybrid callers

The Hybrid Broker (mTLS-terminating translator for on-prem callers, with Site-to-Site VPN + DynamoDB client-id mapping) is **not in this module**. When the feature ships, it will be a **separate sibling module** `modules/s2s-hybrid-broker/` that opts in deliberately:

```hcl
module "hybrid_broker" {
  source   = "github.com/Ziack/s2s-m2m-identity-stack//modules/s2s-hybrid-broker?ref=v2.x.x"
  platform = module.platform.platform
  # ... onprem_cidr, customer_gateway_ip, mtls_trust_chain_arn, mapping ... 
}
```

Reference implementation: see git tag `v1.0.0` for the pre-modularization version (full Network Hub VPC + VPN + ECS + DynamoDB).

## Outputs

| Name | Description |
|---|---|
| `user_pool_id` / `user_pool_arn` / `user_pool_endpoint` | Cognito pool identifiers |
| `cognito_domain` | Hosted domain |
| `resource_server_identifiers` | Map `bounded_context → identifier` |
| `policy_store_ids` / `policy_store_arns` | Maps `bounded_context → AVP store id/arn` |
| `broker_url` / `broker_token_endpoint` / `broker_jwks_uri` / `broker_issuer` | Broker URLs |
| `actor_catalog_secret_arn` | Secrets Manager ARN of the broker's actor catalog. Provisioned with an empty placeholder body; the orchestrator overwrites it with real sha256 hashes after per-service Cognito client_secrets exist. |
| `kms_secrets_key_arn` | CMK for service secrets |
| `redis_endpoint` / `redis_port` | Valkey cache endpoint |
| `alb_listener_arn` / `alb_dns_name` / `alb_security_group_id` / `workload_security_group_id` | Network plane |
| `ecs_cluster_arn` / `ecs_cluster_name` | Cluster |
| `platform` | Composite object — consume as the single input to `s2s-service` |

All outputs are mirrored to SSM under `/${var.environment}/s2s/platform/<output_name>`. Map outputs are JSON-encoded in single String parameters.

## Example

```hcl
module "platform" {
  source = "github.com/Ziack/s2s-m2m-identity-stack//modules/s2s-platform?ref=v2.0.0"

  region                = "us-east-1"
  account_id            = "123456789012"
  environment           = "dev"
  vpc_id                = "vpc-abc"
  private_subnet_ids    = ["subnet-1", "subnet-2"]
  alb_subnet_ids        = ["subnet-1", "subnet-2"]
  user_issuer_url       = "https://keycloak.example.com/realms/m2m"
  bounded_contexts      = ["lending", "deposits"]
  broker_image_uri      = "ghcr.io/ziack/s2s-token-broker:v2.0.0"
  cognito_domain_prefix = "acme-s2s-dev"
}
```

## Pitfalls

- `cognito_domain_prefix` is globally unique across AWS. If reuse is needed, include the AWS account ID as a suffix.
- Removing a bounded_context destroys its policy store and resource server. Use Terraform `moved` blocks for renames.
- SSM parameters are namespaced by `environment`. Two platforms in the same account require distinct environment names.
- Self-signed ACM certificate on the ALB is for fixture/test only — production deployments should attach a real cert via `aws_lb_listener_certificate`.
