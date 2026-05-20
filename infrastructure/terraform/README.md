# s2s-m2m Terraform infrastructure

Terraform port of the original CDK stack. Eight modules under `modules/` mirror
the eight CDK stacks. The root module wires them together and exposes the
outputs the e2e orchestrator consumes.

## Layout

```
infrastructure/terraform/
├── main.tf          # provider, module wiring
├── variables.tf     # root inputs (region, environment, VPN params, image tag)
├── outputs.tf       # orchestrator-consumed outputs (tf-outputs.json keys)
├── versions.tf      # required_providers (aws ~> 5.70, archive ~> 2.4)
├── fixtures/
│   └── example.tfvars   # placeholder values for `terraform plan` smoke
└── modules/
    ├── cognito/
    ├── secrets/         # incl. lambda/ rotation source
    ├── elasticache/
    ├── avp/
    ├── lattice/
    ├── hybrid_broker/
    ├── ecr/
    └── example_services/
```

## Usage

```bash
cd infrastructure/terraform
terraform init
terraform apply -auto-approve
terraform output -json > tf-outputs.json
```

To tear down:

```bash
terraform destroy -auto-approve
```

## Validate (no AWS calls)

```bash
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform plan -var-file=fixtures/example.tfvars -out=/tmp/tfplan
tflint --init && tflint
```

## State backend

Local `terraform.tfstate` (single-dev PoC). No S3/DynamoDB backend.

## Cognito → Secrets bootstrap

The CDK stack used a synchronous `AwsCustomResource` to copy each Cognito
client_secret into Secrets Manager at deploy time. The Terraform port skips
that and instead relies on the rotation Lambda: at apply time
`aws_secretsmanager_secret_rotation` fires a one-shot rotation
(`createSecret → setSecret → testSecret → finishSecret`) which populates
`AWSCURRENT` with the live Cognito-generated client_secret.

The rotation Lambda source lives at `modules/secrets/lambda/`. A pre-built
`index.js` is checked in so `archive_file` can zip it without a TypeScript
build step at apply time.
