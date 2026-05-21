# s2s-service

Terraform module that deploys ONE container service into the S2S Identity Stack. Owns: per-service Cognito app client, client secret in SM, ECR repo, IAM task role, standardised Fargate task definition, ALB target group + listener rule, and Cedar policy injection into the platform's AVP store.

## When to use

Call once per service. The module API is closed by design — there is no input that lets you override the task definition, sidecars, IAM, capabilities, log driver, root-fs, or user. See spec §7.3.

## Inputs

See `variables.tf`. Required: `platform`, `service_name`, `bounded_context`, `image_uri`, `alb_path_pattern`, `alb_listener_rule_priority`.

## Outputs

See `outputs.tf`.

## Example

```hcl
data "aws_ssm_parameter" "platform" { for_each = toset([...]); name = "/dev/s2s/platform/${each.value}" }

module "loan_origination" {
  source = "github.com/Ziack/s2s-m2m-identity-stack//modules/s2s-service?ref=v2.0.0"
  platform           = local.platform
  service_name       = "loan-origination"
  bounded_context    = "lending"
  scopes             = ["lending/write"]
  image_uri          = "..."
  alb_path_pattern   = "/api/loans/*"
  alb_listener_rule_priority = 100
}
```

## Pitfalls

- `var.env` may NOT collide with platform-managed env var names — validation rejects at plan time.
- `bounded_context` must already exist in the platform's `bounded_contexts` list.
- `alb_listener_rule_priority` must be unique across all services attached to the same ALB.
