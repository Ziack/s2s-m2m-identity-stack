# Platform Deployment Guide

Audience: the platform team that runs `terraform apply` against
`modules/s2s-platform/` once per AWS account.

## Prerequisites

- AWS account with `AdministratorAccess` (least-privilege scoping happens
  post-deploy via SCP — see [architecture.md](./architecture.md#hardening))
- VPC with at least 2 private subnets in different AZs (NAT egress required
  for ECR pulls of the broker image)
- Region selection — the platform is single-region; multi-region is out of
  scope for v2 (see spec §12)
- Terraform 1.8, AWS provider `~> 5.60`
- A globally-unique Cognito domain prefix (Cognito requirement)

## Inputs

All inputs documented in `modules/s2s-platform/variables.tf`. The required set:

| Input | Type | Example |
| --- | --- | --- |
| `environment` | string | `"dev"`, `"staging"`, `"prod"` |
| `cognito_domain_prefix` | string | `"myorg-s2s-prod"` |
| `bounded_contexts` | list(string) | `["lending", "payments", "claims"]` |
| `vpc_id` | string | `"vpc-…"` |
| `private_subnet_ids` | list(string) | `["subnet-…", "subnet-…"]` |
| `broker_image` | string | `"ghcr.io/ziack/s2s-token-broker:v2.0.0"` |

Optional inputs (sensible defaults; see variables.tf for full list):

| Input | Default | Notes |
| --- | --- | --- |
| `enable_lattice` | `false` | Provisions VPC Lattice service network |
| `broker_desired_count` | `2` | Fargate task count |
| `valkey_node_type` | `"cache.t4g.small"` | ElastiCache instance |
| `aws_region` | provider default | Inherited from provider block |

## Apply

```bash
cd <your-platform-tf-root>
terraform init
terraform plan -out platform.tfplan
terraform apply platform.tfplan
```

Expected `apply` output (truncated):

```
module.s2s_platform.aws_cognito_user_pool.this: Created
module.s2s_platform.aws_verifiedpermissions_policy_store.contexts["lending"]: Created
module.s2s_platform.aws_verifiedpermissions_policy_store.contexts["payments"]: Created
module.s2s_platform.aws_kms_key.cmk: Created
module.s2s_platform.aws_elasticache_replication_group.valkey: Created
module.s2s_platform.aws_ecs_service.broker: Created
module.s2s_platform.aws_ssm_parameter.broker_jwks_url: Created
…
Outputs:
  broker_health_url   = "https://broker.s2s-dev.internal/health"
  jwks_url            = "https://broker.s2s-dev.internal/.well-known/jwks.json"
  cognito_user_pool_id = "us-east-1_aBcDeFgHi"
```

## Post-deploy verification

```bash
# 1. Broker is healthy
curl -sf "$(terraform output -raw broker_health_url)"
# Expect: {"status":"ok","version":"2.0.0"}

# 2. JWKS publishes the broker signing key
curl -sf "$(terraform output -raw jwks_url)" | jq '.keys[0].kty'
# Expect: "EC"

# 3. SSM parameters published (consumed by every service module)
aws ssm get-parameters-by-path --path "/s2s/dev/" --recursive --query 'Parameters[].Name'
# Expect: /s2s/dev/broker_jwks_url, /s2s/dev/cognito_user_pool_id, /s2s/dev/avp_policy_store_id/lending, etc.
```

## Actor catalog bootstrap

Each bounded context's AVP policy store starts empty. Seed the actor catalog
(the list of permitted service principals) once:

```bash
cd packages/cedar-policies
npx @s2s/cedar-tooling bootstrap \
  --policy-store-id "$(cd <platform-tf-root> && terraform output -raw avp_lending_policy_store_id)" \
  --context lending \
  --principals examples/chained/actor-catalog.json
```

## Cleanup runbook (dev/staging only)

```bash
terraform destroy
```

Manual cleanup (Terraform won't delete these to prevent accidents):
- Cognito user pool deletion-protection is enabled by default. Disable in
  console then re-run `destroy`.
- KMS CMK has `deletion_window_in_days = 30`. Force-delete in console if needed.
