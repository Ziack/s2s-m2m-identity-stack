# Service Deployment Guide

Audience: service teams onboarding a new service to a previously-deployed
S2S platform.

## Prerequisites

- The platform has been deployed (see [platform-deployment.md](./platform-deployment.md))
- You know:
  - Your bounded context (e.g. `lending`)
  - Your service's outbound scope needs (e.g. `lending/loans/read`)
  - The HTTP path the ALB should route to (e.g. `/api/loans`)
- AWS CLI configured for the same account as the platform
- Node.js 20 LTS, Terraform 1.8, Docker

## Step 1 — Scaffold

```bash
npm create @s2s/service@latest my-service
cd my-service
```

The CLI asks five questions interactively. For CI/CD, pass `--non-interactive
--config=service-config.json`:

```json
{
  "name": "my-service",
  "boundedContext": "lending",
  "scopes": ["lending/loans/read"],
  "containerPort": 8080,
  "albPath": "/api/loans"
}
```

## Step 2 — Write Cedar policies

```bash
cd policies
```

Create `permit-read-loans.cedar`:

```cedar
permit (
  principal in M2M::ServicePrincipal::"<peer-service-client-id>",
  action == M2M::Action::"lending/loans/read",
  resource
)
when {
  context.actor_chain[0].client_id == "<peer-service-client-id>"
  && context.user.role == "loan-officer"
};
```

Validate before deploying:

```bash
npx @s2s/cedar-tooling lint policies/
```

See [cedar-authoring.md](./cedar-authoring.md) for the full schema.

## Step 3 — Build and push the container

```bash
docker build -t my-service:v0.1.0 .

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "$(terraform -chdir=terraform output -raw ecr_repo_url)"

docker tag my-service:v0.1.0 "$(terraform -chdir=terraform output -raw ecr_repo_url):v0.1.0"
docker push "$(terraform -chdir=terraform output -raw ecr_repo_url):v0.1.0"
```

(Note: the ECR repo is created on the *first* `terraform apply` even before
you have an image; the apply auto-handles the chicken/egg with a placeholder
task definition.)

## Step 4 — Apply

```bash
cd terraform
terraform init
terraform apply -var "image_tag=v0.1.0"
```

Expected output (truncated):

```
module.s2s_service.aws_ecr_repository.this: Created
module.s2s_service.aws_cognito_user_pool_client.this: Created
module.s2s_service.aws_secretsmanager_secret.client_credentials: Created
module.s2s_service.aws_iam_role.task: Created
module.s2s_service.aws_ecs_task_definition.this: Created
module.s2s_service.aws_ecs_service.this: Created
module.s2s_service.aws_lb_listener_rule.path: Created
…
Outputs:
  alb_url      = "https://platform-alb.dev.internal"
  task_role    = "arn:aws:iam::123:role/s2s-my-service-task"
  ecr_repo_url = "123.dkr.ecr.us-east-1.amazonaws.com/my-service"
```

## Step 5 — Smoke test

```bash
ALB="$(terraform output -raw alb_url)"
curl -sf "$ALB/health"
# {"status":"ok"}

# Verify the SDK middleware is enforcing:
curl -i "$ALB/api/loans"
# HTTP/1.1 401 Unauthorized
# {"error":"invalid_token","reason":"missing bearer"}
```

To call the service from another service, see `examples/chained/calling/` for
the DPoP-bound RFC 8693 token-exchange flow.

## DPoP sender-constraint (cnf.jkt)

As of **v2.2.0**, receivers **hard-enforce** the DPoP `cnf.jkt` sender-constraint
(RFC 9449 §5–6): the broker binds each service token to the holder's exchange-proof
key, and the receiving middleware rejects any request whose DPoP-proof key
thumbprint does not equal the token's `cnf.jkt` with `401 dpop_key_mismatch`.
Scaffolded services get `requireCnfBinding` defaulting to **true**. The cnf check
only applies when DPoP is enabled (`requireDPoP`); with DPoP off it is inert. See
[architecture.md](./architecture.md#dpop-sender-constraint-cnfjkt) for the full
bind/re-bind flow across the chain.

## Upgrade procedure

```bash
# Bump image
docker build -t my-service:v0.2.0 . && docker push …:v0.2.0
terraform apply -var "image_tag=v0.2.0"

# Bump the s2s-service module ref (when a new platform version lands)
# Edit terraform/main.tf — change ?ref=v2.0.0 to ?ref=v2.1.0
terraform init -upgrade
terraform apply
```
