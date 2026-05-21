# s2s-platform

Terraform module that provisions the S2S Identity Stack platform: Cognito user pool, AVP policy stores per bounded context, token broker Fargate, KMS CMKs, Valkey serverless cache, internal ALB, and ECS cluster. Deployed once per environment.

## When to use

Deploy this ONCE per environment (typically per AWS account). Re-apply only when upgrading the platform version, adding bounded contexts, or rotating broker keys.

## Inputs

See `variables.tf`. Required: `region`, `account_id`, `environment`, `vpc_id`, `private_subnet_ids`, `alb_subnet_ids`, `user_issuer_url`, `broker_image_uri`, `cognito_domain_prefix`.

## Outputs

See `outputs.tf`. The composite `platform` output is the canonical input for `s2s-service`.

## Example

```hcl
module "platform" {
  source = "github.com/Ziack/s2s-m2m-identity-stack//modules/s2s-platform?ref=v2.0.0"

  region              = "us-east-1"
  account_id          = "123456789012"
  environment         = "dev"
  vpc_id              = "vpc-abc"
  private_subnet_ids  = ["subnet-1", "subnet-2"]
  alb_subnet_ids      = ["subnet-1", "subnet-2"]
  user_issuer_url     = "https://keycloak.example.com/realms/m2m"
  bounded_contexts    = ["lending", "deposits"]
  broker_image_uri    = "ghcr.io/ziack/s2s-token-broker:v2.0.0"
  cognito_domain_prefix = "acme-s2s-dev"
}
```

## Pitfalls

- `cognito_domain_prefix` must be globally unique across AWS.
- `bounded_contexts` is the closed taxonomy: services join by matching `var.bounded_context` in `s2s-service`.
- Outputs are mirrored to SSM under `/${environment}/s2s/platform/*` for cross-state consumption.
