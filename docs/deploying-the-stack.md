# Deploying the Stack — End-to-End Walkthrough

This is the operator-facing path from a fresh clone to a fully deployed v2
stack: platform + three chained services + actor catalog + smoke test. It
takes ~20 minutes if your AWS credentials and VPC are already in place.

The two existing per-component guides
([`platform-deployment.md`](./platform-deployment.md),
[`service-deployment.md`](./service-deployment.md)) are still authoritative
for the individual modules. This doc stitches them into one runnable flow
and is what [`examples/chained/e2e/src/scripts/deploy-and-test.sh`](../examples/chained/e2e/src/scripts/deploy-and-test.sh)
automates.

---

## 1. Prerequisites

| Tool / resource | Version | Notes |
| --- | --- | --- |
| AWS CLI v2 | `aws --version` ≥ 2.15 | Configured profile with admin-equivalent perms |
| OpenTofu (or Terraform) | `tofu --version` ≥ 1.6 | The repo's `Makefile` + scripts use `tofu` |
| Node.js | ≥ 20 | For SDK + cedar tooling builds |
| Docker | any recent | For building broker + service images |
| jq | any | Script parses tofu output JSON |
| Existing VPC | — | With ≥ 2 private subnets in different AZs; NAT egress required for ECR pulls |
| Globally-unique Cognito domain prefix | — | Lowercase, 3-63 chars `[a-z0-9-]` |

Export your AWS context:

```bash
export AWS_PROFILE=s2s-dev      # whatever profile has perms in the target account
export AWS_REGION=us-east-1     # single-region deploy
export ENVIRONMENT=dev          # becomes part of every name prefix
```

Verify credentials resolve:

```bash
aws sts get-caller-identity
```

## 2. Clone + install workspace deps

```bash
git clone https://github.com/ziack/s2s.git
cd s2s
npm install          # installs every npm workspace (auth-library, broker, services, cedar, e2e)
```

## Step 0a — Provision a VPC for dev (optional)

If you already have a VPC with at least two private subnets in different AZs
and NAT egress, **skip this section** and go straight to step 3.

For a PoC or empty sandbox account, the repo ships a turnkey VPC root at
[`examples/_bootstrap/`](../examples/_bootstrap/) that creates the minimum
network the platform needs (VPC + two public + two private subnets + IGW +
single-AZ NAT + route tables). It is explicitly **not** prod-grade — see
its README for the limitations.

```bash
cd examples/_bootstrap
cp fixtures/dev.tfvars.json.example fixtures/dev.tfvars.json
$EDITOR fixtures/dev.tfvars.json

tofu init
tofu apply -var-file=fixtures/dev.tfvars.json
```

After apply, extract the IDs the platform fixture needs:

```bash
tofu output -json next_steps | jq -r '. | fromjson'
```

The output is a JSON object with `vpc_id`, `private_subnet_ids`, and
`alb_subnet_ids` — paste those three keys directly into
`examples/_platform/fixtures/dev.tfvars.json` in step 3.

> NAT gateway cost reminder: ~$32/month + $0.045/GB processed. Destroy
> `_bootstrap/` last during teardown to stop the meter.

## 3. Fill in `examples/_platform/fixtures/dev.tfvars.json`

```bash
cd examples/_platform
cp fixtures/dev.tfvars.json.example fixtures/dev.tfvars.json
$EDITOR fixtures/dev.tfvars.json
```

At minimum, replace:

- `account_id` — your 12-digit AWS account ID
- `vpc_id`, `private_subnet_ids`, `alb_subnet_ids` — your existing network
- `cognito_domain_prefix` — globally unique
- `user_issuer_url` — your IdP's issuer URL (the broker validates user
  tokens against this issuer in the user-propagation flow)

Real `.tfvars.json` files are gitignored — only the `.example` template is
committed.

## 4. Deploy the platform

```bash
cd examples/_platform
tofu init
tofu apply -var-file=fixtures/dev.tfvars.json
```

This stands up Cognito + AVP + ElastiCache + ALB + ECS + KMS + the broker,
and publishes every output under `/<environment>/s2s/platform/*` in SSM.

Verify SSM publication:

```bash
aws ssm get-parameters-by-path --path /dev/s2s/platform --recursive \
  --query 'Parameters[].Name'
```

You should see 19+ entries (`broker_url`, `policy_store_ids`,
`cognito_domain`, …).

## 5. Build + push the four container images

The broker image and three service images all live in the repo. Tag with
the current git short SHA so each deploy is deterministic.

```bash
cd "$(git rev-parse --show-toplevel)"
export TAG=$(git rev-parse --short HEAD)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ECR_URI

# Broker (ECR repo provisioned by the platform module).
docker build -f packages/token-broker/Dockerfile \
  -t $ECR_URI/s2s/$ENVIRONMENT/token-broker:$TAG .
docker push $ECR_URI/s2s/$ENVIRONMENT/token-broker:$TAG

# Each service (ECR repos provisioned by the s2s-service module, one per service).
for svc in calling-service receiving-service ledger-service; do
  docker build -f examples/chained/$svc/Dockerfile \
    -t $ECR_URI/$ENVIRONMENT/$svc:$TAG .
  docker push $ECR_URI/$ENVIRONMENT/$svc:$TAG
done
```

## 6. Deploy the chained services

Each service has its own Terraform root that reads the platform from SSM —
order doesn't matter for Terraform (the roots are independent state files),
but deploy in the chain order to keep the mental model clean.

```bash
for svc in calling-service receiving-service ledger-service; do
  cd "$(git rev-parse --show-toplevel)/examples/chained/$svc/terraform"
  tofu init
  tofu apply -auto-approve \
    -var "account_id=$ACCOUNT_ID" \
    -var "region=$AWS_REGION" \
    -var "environment=$ENVIRONMENT" \
    -var "image_tag=$TAG"
done
```

Each apply:

- Provisions a Cognito app client + writes the client_secret to Secrets
  Manager at `<env>-s2s/<svc>/cognito/client-secret`
- Creates an ECR repo (already used in step 5)
- Registers an ECS task definition + service on the platform's cluster
- Adds an ALB listener rule + target group
- Uploads any service-owned Cedar policies into the bounded-context's AVP
  policy store

## 7. Bootstrap the actor catalog

The broker rejects token-exchange requests until its actor-catalog secret
contains the sha256 of each caller's Cognito client_secret. As of v2.0.4
the platform module provisions the catalog secret automatically (with an
empty `{}` placeholder body so the broker boots cleanly on first apply)
— the operator just overwrites the body with the real hashes and forces
a broker redeploy so the new catalog is loaded.

```bash
ENVIRONMENT=dev   # match your fixtures
CATALOG_SECRET_ID="$ENVIRONMENT-s2s/platform/broker/actor-catalog"

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
  "calling-service":   { "client_secret_hash": "sha256:${CALLING_HASH}",   "allowed_audiences": ["lending"], "allowed_scopes": ["lending/read","lending/write"] },
  "receiving-service": { "client_secret_hash": "sha256:${RECEIVING_HASH}", "allowed_audiences": ["ledger"],  "allowed_scopes": ["ledger/read","ledger/write"] }
}
JSON

aws secretsmanager put-secret-value \
  --secret-id "$CATALOG_SECRET_ID" \
  --secret-string file:///tmp/actor-catalog.json

# Force the broker to reload.
CLUSTER=$(aws ssm get-parameter --name /$ENVIRONMENT/s2s/platform/ecs_cluster_name \
  --query Parameter.Value --output text)
BROKER_SVC=$(aws ecs list-services --cluster $CLUSTER \
  --query 'serviceArns[?contains(@, `broker`)] | [0]' --output text)
aws ecs update-service --cluster $CLUSTER --service $BROKER_SVC --force-new-deployment
aws ecs wait services-stable --cluster $CLUSTER --services $BROKER_SVC
```

## 8. Smoke test with the Postman collection

The repo ships a Postman collection at `docs/postman/` covering the
happy-path token exchanges plus the user-propagation matrix.

1. Import `docs/postman/s2s-happy-path.json` into Postman (or `newman`).
2. Set the environment variables in the collection: `broker_url`,
   `alb_dns`, `cognito_domain`, `calling_client_id`, `calling_client_secret`
   (read from `aws secretsmanager get-secret-value …/calling-service/…`).
3. Run the collection — every request should pass.

For the full automated vitest suite:

```bash
npm --workspace @s2s/example-chained-e2e test
```

---

## Teardown

The orchestrator script destroys in reverse order:

```bash
bash examples/chained/e2e/src/scripts/deploy-and-test.sh teardown
```

Internally that runs `tofu destroy` for each service root, then for the
platform root.

### RETAIN-policy resources (manual cleanup)

Several platform resources use `lifecycle { prevent_destroy }` or `RETAIN`
deletion policies so accidental `tofu destroy` doesn't nuke long-lived
identity primitives. After a clean teardown the following remain in your
account and must be removed manually if you want a fully empty environment:

#### KMS keys

```bash
# List orphaned aliases.
aws kms list-aliases --query "Aliases[?contains(AliasName, 's2s')]"

# For each:
aws kms schedule-key-deletion --key-id <key-id> --pending-window-in-days 7
aws kms delete-alias --alias-name alias/s2s-<env>-secrets
```

(7-day pending window is the minimum AWS allows.)

#### Cognito user pool + domain

```bash
USER_POOL_ID=$(aws ssm get-parameter --name /$ENVIRONMENT/s2s/platform/user_pool_id \
  --query Parameter.Value --output text 2>/dev/null || echo "")
# Custom domain first.
aws cognito-idp delete-user-pool-domain \
  --domain <your-cognito_domain_prefix> --user-pool-id $USER_POOL_ID
# Then the pool itself.
aws cognito-idp delete-user-pool --user-pool-id $USER_POOL_ID
```

#### ECR repositories

ECR repos hold images and won't be deleted if non-empty.

```bash
for repo in s2s/$ENVIRONMENT/token-broker \
            $ENVIRONMENT/calling-service \
            $ENVIRONMENT/receiving-service \
            $ENVIRONMENT/ledger-service; do
  aws ecr delete-repository --repository-name $repo --force
done
```

#### Secrets Manager entries

Secrets Manager has a 7-30 day recovery window by default. Force-delete
immediately:

```bash
for secret in $ENVIRONMENT-s2s/platform/broker/signing-key \
              $ENVIRONMENT-s2s/platform/broker/actor-catalog \
              $ENVIRONMENT-s2s/calling-service/cognito/client-secret \
              $ENVIRONMENT-s2s/receiving-service/cognito/client-secret \
              $ENVIRONMENT-s2s/ledger-service/cognito/client-secret; do
  aws secretsmanager delete-secret --secret-id "$secret" --force-delete-without-recovery
done
```

#### CloudWatch log groups

```bash
for lg in /s2s/platform/broker /s2s/platform/audit; do
  aws logs delete-log-group --log-group-name "$lg" 2>/dev/null || true
done
# Per-service log groups.
aws logs describe-log-groups --log-group-name-prefix "/s2s/$ENVIRONMENT" \
  --query 'logGroups[].logGroupName' --output text \
  | xargs -n1 -I{} aws logs delete-log-group --log-group-name {}
```

#### SSM parameters

`tofu destroy` removes these, but if state was lost you can sweep:

```bash
aws ssm get-parameters-by-path --path /$ENVIRONMENT/s2s/platform --recursive \
  --query 'Parameters[].Name' --output text \
  | xargs -n1 aws ssm delete-parameter --name
```

#### AVP policy stores

```bash
aws verifiedpermissions list-policy-stores \
  --query 'policyStores[?contains(description, `s2s`)].policyStoreId' --output text \
  | xargs -n1 -I{} aws verifiedpermissions delete-policy-store --policy-store-id {}
```

After all of the above, `aws resourcegroupstaggingapi get-resources
--tag-filters Key=managed-by,Values=terraform` should return an empty list
for the s2s tag namespace.
