# `examples/_platform/` — deployable platform root

This is the canonical, one-shot Terraform root that stands up
`modules/s2s-platform/` on its own. Every other example under `examples/`
calls `modules/s2s-service` and **reads platform outputs from SSM**, which
assumes the platform already exists. This root is what creates it.

The underscore prefix (`_platform/`) keeps this directory at the top of
`examples/` alphabetically and signals "infrastructure, not a service
example".

## Prerequisites

This root assumes you already have a VPC with at least two private subnets
in different AZs and NAT egress (the broker ECS task pulls images from ECR
and needs outbound HTTPS). **If you don't have one**, run
[`examples/_bootstrap/`](../_bootstrap/) first — it creates a minimal
PoC-grade VPC and prints a `next_steps` JSON blob you paste straight into
this root's `dev.tfvars.json`.

## What it provisions

A single call to `module "platform" { source = "../../modules/s2s-platform" }`,
which creates:

- Cognito user pool + hosted-UI domain + per-context resource servers
- Per-context AVP policy stores
- ElastiCache Serverless (Redis) for broker DPoP nonce + replay caches
- Internal ALB + listener + workload/ALB security groups
- ECS cluster + token-broker task definition, service, IAM roles, log groups
- KMS key for secrets + Secrets Manager entries for the broker signing key
- SSM parameters under `/<environment>/s2s/platform/*` consumed by every
  `s2s-service` caller (the contract is **frozen** — see
  `modules/s2s-platform/outputs.tf`)

## Layout

```
examples/_platform/
├── README.md                    # this file
├── main.tf                      # module "platform" call
├── variables.tf                 # 1:1 with modules/s2s-platform/variables.tf
├── outputs.tf                   # pass-through of every module output
├── versions.tf                  # terraform >= 1.6, aws ~> 5.0, tls ~> 4.0, random ~> 3.6
├── fixtures/
│   └── dev.tfvars.json.example  # template — operator copies + edits
└── .gitignore                   # drops real *.tfvars / .tfstate
```

## Apply walkthrough

Prerequisites — AWS credentials, an existing VPC with at least 2 private
subnets in different AZs (NAT egress required for ECR pulls), and a globally
unique Cognito domain prefix.

```bash
cd examples/_platform

# 1. Copy + edit the fixture. Fill in account_id, vpc_id, subnet IDs,
#    cognito_domain_prefix, user_issuer_url at minimum.
cp fixtures/dev.tfvars.json.example fixtures/dev.tfvars.json
$EDITOR fixtures/dev.tfvars.json

# 2. Init + apply.
tofu init
tofu apply -var-file=fixtures/dev.tfvars.json

# 3. Verify SSM publication (the platform writes every output here too).
aws ssm get-parameters-by-path --path /dev/s2s/platform --recursive \
  --query 'Parameters[].Name'
```

After apply, every `examples/chained/*/terraform/` root (and any caller of
`modules/s2s-service`) will pick up the platform via SSM data sources. No
explicit cross-stack references required.

## Outputs

`outputs.tf` re-exports every output from the module. The most useful for
operators after apply:

| Output | Use |
| --- | --- |
| `broker_url` | Issuer URL the broker mints under |
| `broker_jwks_uri` | JWKS endpoint downstream services pin |
| `cognito_domain` | Hosted-UI domain for `oauth2/token` exchanges |
| `policy_store_ids` | Map of `bounded_context => AVP store id` |
| `alb_dns_name` | Internal ALB hostname |

The full composite is `terraform output -json platform`, which is the
canonical object you would pass into `module "service" { platform = ... }`
if you wired services up via Terraform module composition rather than SSM.

## Teardown

```bash
tofu destroy -var-file=fixtures/dev.tfvars.json
```

A handful of resources are `RETAIN`-policy'd by the platform module (KMS
keys, Cognito user pool, ECR repos, CloudWatch log groups) and must be
removed manually if you want a fully clean account. See
[`docs/deploying-the-stack.md`](../../docs/deploying-the-stack.md#teardown)
for the cleanup runbook.

## Version pinning

This root tracks the repo it lives in. The matching tag is `v2.0.2` — the
`broker_image_uri` default in `fixtures/dev.tfvars.json.example` points at
`ghcr.io/ziack/s2s-token-broker:v2.0.2`. If you pin via
`source = "git::…?ref=v2.0.2"`, update the broker image to match.
