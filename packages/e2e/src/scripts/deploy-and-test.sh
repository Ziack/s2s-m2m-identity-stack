#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
TF_DIR="$ROOT/infrastructure/terraform"
OUTPUTS="$TF_DIR/tf-outputs.json"

# Teardown dispatch (must be first so it short-circuits).
if [[ "${1:-}" == "teardown" ]]; then
  cd "$TF_DIR"
  terraform destroy -auto-approve
  exit 0
fi

: "${AWS_PROFILE:=s2s-dev}"
: "${AWS_REGION:=us-east-1}"

# Deterministic image tag passed to Terraform via TF_VAR_image_tag.
export TF_VAR_image_tag="$(git rev-parse --short HEAD)"
# Per-run namespace for E2E dedup keys.
export E2E_RUN_ID="$(uuidgen)"

echo "==> 1/7  Build SDK + services"
npm --workspace @s2s/auth-library run build
npm --workspace @s2s/calling-service run build
npm --workspace @s2s/receiving-service run build

echo "==> 2/7  Terraform apply (infrastructure)"
cd "$TF_DIR"
terraform init
terraform apply -auto-approve
terraform output -json > "$OUTPUTS"
cd "$ROOT"

# Parse stack outputs into env vars used by downstream steps.
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
export AVP_LENDING_POLICY_STORE_ID="$(jq -r '.avp_lending_policy_store_id.value' "$OUTPUTS")"
# Plan 03's Cedar upload reads AVP_POLICY_STORE_ID; alias the canonical name to it.
export AVP_POLICY_STORE_ID="$AVP_LENDING_POLICY_STORE_ID"
export USER_POOL_ID="$(jq -r '.cognito_user_pool_id.value' "$OUTPUTS")"

echo "==> 3/7  Build + push Docker images to ECR (tag=$TF_VAR_image_tag)"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_URI"
docker build -f "$ROOT/packages/examples/calling-service/Dockerfile"   -t "$ECR_URI/s2s-calling-service:$TF_VAR_image_tag"   "$ROOT"
docker build -f "$ROOT/packages/examples/receiving-service/Dockerfile" -t "$ECR_URI/s2s-receiving-service:$TF_VAR_image_tag" "$ROOT"
docker push "$ECR_URI/s2s-calling-service:$TF_VAR_image_tag"
docker push "$ECR_URI/s2s-receiving-service:$TF_VAR_image_tag"

echo "==> 4/7  Terraform apply again (ECS services pick up new image tag)"
cd "$TF_DIR"
terraform apply -auto-approve
terraform output -json > "$OUTPUTS"
cd "$ROOT"

# Re-export ALB + queue now that example_services is up.
export ALB_DNS="$(jq -r '.alb_dns_name.value' "$OUTPUTS")"
export QUEUE_URL="$(jq -r '.lending_queue_url.value' "$OUTPUTS")"

echo "==> 5/7  Upload Cedar policies to AVP"
npm --workspace @s2s/cedar-policies run upload

echo "==> 6/7  Wait for ECS services to reach steady state"
CLUSTER="s2s-s2s-poc"
SERVICE_ARNS="$(aws ecs list-services --cluster "$CLUSTER" --query 'serviceArns[]' --output text)"
aws ecs wait services-stable --cluster "$CLUSTER" --services $SERVICE_ARNS

echo "==> 7/7  Run e2e suites (run_id=$E2E_RUN_ID)"
export TF_OUTPUTS_PATH="$OUTPUTS"
npm --workspace @s2s/e2e test

echo "All e2e suites passed."
