#!/usr/bin/env bash
set -euo pipefail

# Teardown dispatch (must be first so it short-circuits).
if [[ "${1:-}" == "teardown" ]]; then
  npm --workspace @s2s/cdk-infra exec -- cdk destroy --all --force
  exit 0
fi

: "${AWS_PROFILE:=s2s-dev}"
: "${AWS_REGION:=us-east-1}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUTPUTS="$ROOT/packages/cdk-infra/cdk-outputs.json"

# Deterministic image tag passed to CDK via IMAGE_TAG env var (Patch A contract).
export IMAGE_TAG="$(git rev-parse --short HEAD)"
# Per-run namespace for E2E dedup keys (Patch F).
export E2E_RUN_ID="$(uuidgen)"

echo "==> 1/7  Build SDK + services"
npm --workspace @s2s/auth-library run build
npm --workspace @s2s/calling-service run build
npm --workspace @s2s/receiving-service run build

echo "==> 2/7  CDK deploy infra stacks (excluding ExampleServicesStack)"
# Deploy infra first; ExampleServicesStack depends on ECR repos populated in step 4.
npm --workspace @s2s/cdk-infra exec -- cdk deploy \
  CognitoM2MStack SecretsStack ElastiCacheStack AvpCedarStack \
  LatticeStack HybridBrokerStack EcrStack \
  --require-approval never --outputs-file "$OUTPUTS"

# Parse stack outputs into env vars used by downstream steps.
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
export AVP_LENDING_POLICY_STORE_ID="$(jq -r '.AvpCedarStack.LendingPolicyStoreId' "$OUTPUTS")"
# Plan 03's Cedar upload reads AVP_POLICY_STORE_ID; alias the canonical name to it.
export AVP_POLICY_STORE_ID="$AVP_LENDING_POLICY_STORE_ID"
export USER_POOL_ID="$(jq -r '.CognitoM2MStack.UserPoolId' "$OUTPUTS")"

echo "==> 3/7  Build + push Docker images to ECR (tag=$IMAGE_TAG)"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_URI"
docker build -f "$ROOT/packages/examples/calling-service/Dockerfile"   -t "$ECR_URI/s2s-calling-service:$IMAGE_TAG"   "$ROOT"
docker build -f "$ROOT/packages/examples/receiving-service/Dockerfile" -t "$ECR_URI/s2s-receiving-service:$IMAGE_TAG" "$ROOT"
docker push "$ECR_URI/s2s-calling-service:$IMAGE_TAG"
docker push "$ECR_URI/s2s-receiving-service:$IMAGE_TAG"

echo "==> 4/7  CDK deploy ExampleServicesStack (consumes IMAGE_TAG)"
npm --workspace @s2s/cdk-infra exec -- cdk deploy ExampleServicesStack \
  --require-approval never --outputs-file "$OUTPUTS"

# Re-export ALB + queue now that ExampleServicesStack is deployed.
export ALB_DNS="$(jq -r '.ExampleServicesStack.AlbDnsName' "$OUTPUTS")"
export QUEUE_URL="$(jq -r '.ExampleServicesStack.LendingQueueUrl' "$OUTPUTS")"

echo "==> 5/7  Upload Cedar policies to AVP"
npm --workspace @s2s/cedar-policies run upload

echo "==> 6/7  Wait for ECS services to reach steady state"
CLUSTER="s2s-s2s-poc"
SERVICE_ARNS="$(aws ecs list-services --cluster "$CLUSTER" --query 'serviceArns[]' --output text)"
aws ecs wait services-stable --cluster "$CLUSTER" --services $SERVICE_ARNS

echo "==> 7/7  Run e2e suites (run_id=$E2E_RUN_ID)"
export CDK_OUTPUTS_PATH="$OUTPUTS"
npm --workspace @s2s/e2e test

echo "All e2e suites passed."
