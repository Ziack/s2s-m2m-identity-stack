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
| `enable_lattice` | bool | no | `false` | Provision the VPC Lattice service-to-service plane (service network + broker Lattice service). See [VPC Lattice](#vpc-lattice-service-to-service). |
| `tags` | map(string) | no | `{}` | Tags merged onto every resource |

## VPC Lattice service-to-service

Set `enable_lattice = true` to provision a VPC Lattice transport for internal,
SigV4-authenticated service-to-service calls. This is the receiving side of the
SDK's `createLatticeFetch` client (shipped in Phase 1).

- **`false` (default):** none of the Lattice resources are created. The broker is
  reachable only via the internal ALB — exact v2.0.x behavior.
- **`true`:** the broker is reachable over **both** the ALB (direct/debug access)
  **and** a VPC Lattice service with `AWS_IAM` auth (the SigV4-authenticated S2S
  path). The ALB remains the user-facing ingress; Lattice handles internal hops.

When enabled, the platform provisions:

- An `aws_vpclattice_service_network` (`${env}-s2s-net`, `auth_type = AWS_IAM`),
  associated with the workload VPC using the workload security group so tasks can
  resolve and reach Lattice service DNS.
- Access logging: a KMS-encrypted (platform CMK), public-access-blocked S3 bucket
  (`prevent_destroy`) + a CloudWatch log group `/aws/vpclattice/${env}-s2s`, with
  both an S3 and a CloudWatch access-log subscription on the service network.
- The **broker's** Lattice service (`${env}-s2s-broker`, `AWS_IAM`): an `IP` target
  group (HTTP:8080, health check `/health`), an HTTP:80 listener that forwards to
  it (Lattice terminates TLS; the broker speaks plain HTTP), an auth policy, and
  the service-network association.
- The broker ECS service is registered with the Lattice target group via the
  `vpc_lattice_configurations` block (ECS manages IP (de)registration of Fargate
  tasks via a dedicated `vpc-lattice:*Targets` role).

**Auth model.** The service network and broker service use `AWS_IAM` auth: every
call must be SigV4-signed (`vpc-lattice-svcs:Invoke`). The broker's auth policy
currently **allows any principal within this AWS account** (`aws:PrincipalAccount`
condition). The tightening path (Phase 3) is to replace that account-wide allow
with explicit `Principal` ARNs for the per-service calling/receiving task roles —
those ARNs are created by `s2s-service` and don't exist at platform-apply time.

Ownership: the platform owns the service network and the broker's Lattice service.
Each app service's own Lattice service is owned by `s2s-service`.

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
| `lattice_service_network_id` / `lattice_service_network_arn` | VPC Lattice service network identifiers. `null` when `enable_lattice = false`. |
| `broker_lattice_dns` | Broker Lattice service DNS name (`dns_entry[0].domain_name`) — the SigV4 S2S endpoint for the broker. `null` when `enable_lattice = false`. |
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
- **Insecure-TLS escape hatch:** with the self-signed cert, outbound HTTPS between services fails certificate verification. Services expose an opt-in, default-OFF flag `ALLOW_INSECURE_TLS=true` (handled by `applyInsecureTlsEscapeHatch` in `@s2s/auth-library`) that disables outbound TLS verification for the PoC path. Production MUST attach a real ACM cert and leave `ALLOW_INSECURE_TLS` unset.
- **Authorization request shape (Cedar STRICT):** services authorize via AVP `IsAuthorized` (entity-based) using `M2M::Action::<schema action>` and `M2M::ResourceGroup::<resourcePrefix>-resources`, with the principal as an `M2M::ServicePrincipal` entity. Each route binds an explicit Cedar action — `buildBrokerAuthMiddleware(config, { action, resourceGroup })` (sync) — rather than deriving one from the HTTP method+path; otherwise no policy matches under STRICT. The async (SQS/envelope) path forwards the end-user identity inside the signed envelope (`signEnvelope({ user })`) and sets `envelope_verified: true` after verifying the envelope, so the global DPoP gate admits it as sender-constrained and user-gated policies apply without DPoP.
