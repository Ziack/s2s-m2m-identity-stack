# Getting Started — your first S2S-integrated service in 30 minutes

This walks two developers (or one wearing both hats) through deploying the
platform, scaffolding a service, and seeing it call another service via the
token broker with DPoP-bound RFC 8693 token exchange.

## Prerequisites (5 min)

- An AWS account you can deploy to (a fresh dev account is ideal)
- An IAM role with `AdministratorAccess` (we narrow this in production via SCP)
- AWS CLI v2 configured: `aws sts get-caller-identity` should succeed
- Terraform 1.8+
- Node.js 20 LTS
- Docker (for the broker container build)
- `gh` CLI logged in (for GHCR pull on the broker image)

## Step 1 — Deploy the platform (10 min)

Create a folder for your platform Terraform root:

```bash
mkdir -p ~/s2s-platform-root && cd ~/s2s-platform-root
```

Create `main.tf`:

```hcl
terraform {
  required_version = "~> 1.8"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}

provider "aws" {
  region = "us-east-1"
}

module "s2s_platform" {
  source = "git::https://github.com/Ziack/s2s-m2m-identity-stack.git//modules/s2s-platform?ref=v2.0.0"

  environment            = "dev"
  cognito_domain_prefix  = "myorg-s2s-dev"   # must be globally unique
  bounded_contexts       = ["lending", "payments"]
  vpc_id                 = "vpc-0123456789abcdef0"
  private_subnet_ids     = ["subnet-aaa", "subnet-bbb"]
  broker_image           = "ghcr.io/ziack/s2s-token-broker:v2.0.0"
}

output "platform" {
  value = module.s2s_platform
}
```

Apply:

```bash
terraform init
terraform apply
```

When apply completes, verify the broker is healthy:

```bash
curl -sf "$(terraform output -raw platform | jq -r .broker_health_url)"
# {"status":"ok","version":"2.0.0"}

curl -sf "$(terraform output -raw platform | jq -r .jwks_url)" | jq .keys
# [ { "kty": "EC", "crv": "P-256", ... } ]
```

## Step 2 — Scaffold a service (5 min)

```bash
cd ~ && npm create @s2s/service@latest my-first-service
```

Answer the prompts (bounded context: `lending`; bounded scopes: `lending/loans/read`;
container port: `8080`; ALB path: `/api/loans`). The CLI writes the project to
`./my-first-service/` with a TF root, Dockerfile, source skeleton, and tests.

Alternatively, non-interactive:

```bash
npm create @s2s/service@latest -- \
  --non-interactive \
  --config=./service-config.json \
  my-first-service
```

## Step 3 — Build and push the container (5 min)

```bash
cd ~/my-first-service
npm install
npm test          # vitest passes against the scaffold
docker build -t my-first-service:dev .

# Push to the per-service ECR repo created by module.s2s_service:
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "<ECR-URL-from-tf-output>"
docker tag my-first-service:dev "<ECR-URL>/my-first-service:v0.1.0"
docker push "<ECR-URL>/my-first-service:v0.1.0"
```

## Step 4 — Deploy the service (5 min)

```bash
cd ~/my-first-service/terraform
terraform init
terraform apply -var "image_tag=v0.1.0"
```

## Step 5 — Smoke test

```bash
ALB="$(terraform output -raw alb_url)"
curl -sf "$ALB/health"
# {"status":"ok"}
```

## Next steps

- Add Cedar policies: see [cedar-authoring.md](./cedar-authoring.md)
- Wire a second service that calls this one: see [examples/chained/](../examples/chained/)
- Onboard an existing Express/Fastify/Koa app: see [onboarding-existing-app.md](./onboarding-existing-app.md)
