#!/usr/bin/env bash
# Orchestrates a full deploy-and-test cycle for the v2 chained example.
#
# Layout assumptions (post-v2 modular split):
#   examples/_platform/                                      — platform root
#   examples/chained/{calling,receiving,ledger}-service/     — service code + Dockerfile + terraform/ root
#   packages/token-broker/Dockerfile                         — broker image
#   modules/{s2s-platform,s2s-service}/                      — frozen modules (don't touch)
#
# Steps:
#   1. Build SDK + cedar tooling
#   2. Deploy platform              (examples/_platform → SSM)
#   3. Build + push 4 container images (broker + 3 services)
#   4. Deploy each service's terraform root
#   5. Upload Cedar policies to AVP
#   6. Bootstrap actor catalog (sha256 of Cognito client_secrets)
#   7. Wait for ECS steady-state
#   8. Run vitest e2e suite
#
# Usage:
#   bash deploy-and-test.sh             # full deploy + test
#   bash deploy-and-test.sh teardown    # destroy in reverse order
#
# Required env (with defaults):
#   AWS_PROFILE  — default: s2s-dev
#   AWS_REGION   — default: us-east-1
#   ENVIRONMENT  — default: dev (must match fixtures/dev.tfvars.json :: environment)
#   TFVARS_FILE  — default: $PLATFORM_ROOT/fixtures/dev.tfvars.json
#
# The script uses `tofu` (OpenTofu). Substitute `terraform` if you prefer —
# the two are CLI-compatible for everything we invoke.

set -euo pipefail

# --- Paths ----------------------------------------------------------------

# This script lives at examples/chained/e2e/src/scripts/deploy-and-test.sh
# Repo root is five levels up.
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"

PLATFORM_ROOT="$ROOT/examples/_platform"
CHAINED_ROOT="$ROOT/examples/chained"
SERVICES=(calling-service receiving-service ledger-service)

: "${AWS_PROFILE:=s2s-dev}"
: "${AWS_REGION:=us-east-1}"
: "${ENVIRONMENT:=dev}"
: "${TFVARS_FILE:=$PLATFORM_ROOT/fixtures/dev.tfvars.json}"

export AWS_PROFILE AWS_REGION

PLATFORM_OUTPUTS="/tmp/s2s-platform-outputs.json"
TF="${TF:-tofu}"

# --- Teardown -------------------------------------------------------------

if [[ "${1:-}" == "teardown" ]]; then
  echo "==> Teardown — destroying in reverse order"
  # Services first (they hold ALB listener rules + target groups + Cognito clients).
  for svc in "${SERVICES[@]}"; do
    if [[ -d "$CHAINED_ROOT/$svc/terraform/.terraform" ]]; then
      echo "  -- destroy $svc"
      (cd "$CHAINED_ROOT/$svc/terraform" && "$TF" destroy -auto-approve)
    fi
  done
  # Platform last.
  if [[ -d "$PLATFORM_ROOT/.terraform" ]]; then
    echo "  -- destroy platform"
    (cd "$PLATFORM_ROOT" && "$TF" destroy -auto-approve -var-file="$TFVARS_FILE")
  fi
  echo
  echo "Done. NOTE: some platform resources are RETAIN-policy'd and will linger:"
  echo "  - KMS keys (schedule deletion: aws kms schedule-key-deletion --key-id <id>)"
  echo "  - Cognito user pool (aws cognito-idp delete-user-pool --user-pool-id <id>)"
  echo "  - ECR repos with images (aws ecr delete-repository --force ...)"
  echo "  - CloudWatch log groups (/s2s/platform/*)"
  echo "  See docs/deploying-the-stack.md#teardown for the full cleanup runbook."
  exit 0
fi

# --- Sanity checks --------------------------------------------------------

if [[ ! -f "$TFVARS_FILE" ]]; then
  echo "ERROR: tfvars file not found: $TFVARS_FILE"
  echo "       cp $PLATFORM_ROOT/fixtures/dev.tfvars.json.example $TFVARS_FILE"
  echo "       then edit account_id, vpc_id, subnets, cognito_domain_prefix."
  exit 1
fi

command -v "$TF" >/dev/null || { echo "ERROR: $TF not on PATH"; exit 1; }
command -v aws >/dev/null   || { echo "ERROR: aws CLI not on PATH"; exit 1; }
command -v docker >/dev/null || { echo "ERROR: docker not on PATH"; exit 1; }
command -v jq >/dev/null     || { echo "ERROR: jq not on PATH"; exit 1; }

# Deterministic image tag passed to every per-service Terraform root via TF_VAR_image_tag.
export TF_VAR_image_tag="$(git -C "$ROOT" rev-parse --short HEAD)"
# Per-run namespace for e2e dedup keys.
export E2E_RUN_ID="$(uuidgen)"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# --- 1. Build SDK + cedar tooling -----------------------------------------

echo "==> 1/8  Build SDK + cedar tooling"
npm --workspace @s2s/auth-library run build
# Cedar tooling has no compile step (it's tsx-only) — validate as a smoke test.
npm --workspace @s2s/cedar-policies run validate

# --- 2. Deploy platform ---------------------------------------------------

echo "==> 2/8  Deploy platform ($PLATFORM_ROOT)"
(
  cd "$PLATFORM_ROOT"
  "$TF" init -input=false
  "$TF" apply -input=false -auto-approve -var-file="$TFVARS_FILE"
  "$TF" output -json > "$PLATFORM_OUTPUTS"
)

BROKER_URL="$(jq -r '.broker_url.value' "$PLATFORM_OUTPUTS")"
ALB_DNS="$(jq -r '.alb_dns_name.value' "$PLATFORM_OUTPUTS")"
ECS_CLUSTER_NAME="$(jq -r '.ecs_cluster_name.value' "$PLATFORM_OUTPUTS")"
COGNITO_DOMAIN="$(jq -r '.cognito_domain.value' "$PLATFORM_OUTPUTS")"

export ALB_DNS BROKER_URL COGNITO_DOMAIN
export TF_OUTPUTS_PATH="$PLATFORM_OUTPUTS"

# --- 3. Build + push container images -------------------------------------

echo "==> 3/8  Build + push container images (tag=$TF_VAR_image_tag)"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_URI"

# Broker repo is provisioned by the platform module under a fixed name.
BROKER_REPO="$ECR_URI/s2s/$ENVIRONMENT/token-broker"
docker build -f "$ROOT/packages/token-broker/Dockerfile" \
  -t "$BROKER_REPO:$TF_VAR_image_tag" "$ROOT"
docker push "$BROKER_REPO:$TF_VAR_image_tag"

# Per-service repos are provisioned by s2s-service (one per service).
for svc in "${SERVICES[@]}"; do
  REPO="$ECR_URI/$ENVIRONMENT/$svc"
  docker build -f "$CHAINED_ROOT/$svc/Dockerfile" \
    -t "$REPO:$TF_VAR_image_tag" "$ROOT"
  docker push "$REPO:$TF_VAR_image_tag"
done

# --- 4. Deploy each service's terraform root ------------------------------

echo "==> 4/8  Deploy services (calling, receiving, ledger)"
for svc in "${SERVICES[@]}"; do
  echo "  -- $svc"
  (
    cd "$CHAINED_ROOT/$svc/terraform"
    "$TF" init -input=false
    "$TF" apply -input=false -auto-approve \
      -var "account_id=$ACCOUNT_ID" \
      -var "region=$AWS_REGION" \
      -var "environment=$ENVIRONMENT"
  )
done

# --- 5. Upload Cedar policies --------------------------------------------

echo "==> 5/8  Upload Cedar policies to AVP"
export AVP_POLICY_STORE_ID="$(jq -r '.policy_store_ids.value.lending' "$PLATFORM_OUTPUTS")"
npm --workspace @s2s/cedar-policies run upload

# --- 6. Bootstrap actor catalog -------------------------------------------

echo "==> 6/8  Bootstrap actor catalog (sha256 of Cognito client_secrets)"
# Each service module writes its Cognito client_secret to a Secrets Manager
# secret named "<env>-s2s/<service>/cognito/client-secret". The broker reads
# the actor catalog from a separate secret (ACTOR_CATALOG_SECRET_ARN). The
# platform module v2.0.2 does NOT yet provision that secret — the operator
# is expected to create it on first run and re-deploy the broker. We do so
# here.
CALLING_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "$ENVIRONMENT-s2s/calling-service/cognito/client-secret" \
  --query SecretString --output text)
RECEIVING_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "$ENVIRONMENT-s2s/receiving-service/cognito/client-secret" \
  --query SecretString --output text)

CALLING_HASH=$(printf "%s" "$CALLING_SECRET" | shasum -a 256 | awk '{print $1}')
RECEIVING_HASH=$(printf "%s" "$RECEIVING_SECRET" | shasum -a 256 | awk '{print $1}')

cat > /tmp/actor-catalog.json <<JSON
{
  "calling-service": {
    "client_secret_hash": "sha256:${CALLING_HASH}",
    "allowed_audiences": ["lending"],
    "allowed_scopes": ["lending/read","lending/write"]
  },
  "receiving-service": {
    "client_secret_hash": "sha256:${RECEIVING_HASH}",
    "allowed_audiences": ["ledger"],
    "allowed_scopes": ["ledger/read","ledger/write"]
  }
}
JSON

# Idempotent create-or-update on the catalog secret.
CATALOG_SECRET_ID="$ENVIRONMENT-s2s/platform/broker/actor-catalog"
if aws secretsmanager describe-secret --secret-id "$CATALOG_SECRET_ID" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$CATALOG_SECRET_ID" \
    --secret-string file:///tmp/actor-catalog.json >/dev/null
else
  aws secretsmanager create-secret \
    --name "$CATALOG_SECRET_ID" \
    --secret-string file:///tmp/actor-catalog.json >/dev/null
fi

# Force the broker to reload the catalog.
aws ecs update-service \
  --cluster "$ECS_CLUSTER_NAME" \
  --service "$(aws ecs list-services --cluster "$ECS_CLUSTER_NAME" \
               --query 'serviceArns[?contains(@, `broker`)] | [0]' --output text)" \
  --force-new-deployment >/dev/null

# --- 7. Wait for ECS steady-state -----------------------------------------

echo "==> 7/8  Wait for ECS services to reach steady state"
SERVICE_ARNS="$(aws ecs list-services --cluster "$ECS_CLUSTER_NAME" \
                --query 'serviceArns[]' --output text)"
# shellcheck disable=SC2086
aws ecs wait services-stable --cluster "$ECS_CLUSTER_NAME" --services $SERVICE_ARNS

# --- 8. Run e2e suite -----------------------------------------------------

echo "==> 8/8  Run e2e suites (run_id=$E2E_RUN_ID)"
npm --workspace @s2s/example-chained-e2e test

echo
echo "All e2e suites passed."
echo "  Broker URL:       $BROKER_URL"
echo "  ALB:              $ALB_DNS"
echo "  Cognito domain:   $COGNITO_DOMAIN"
echo
echo "Smoke-test the deployment with the Postman collection in docs/postman/."
echo "Teardown:  bash $0 teardown"
