# token_broker

Terraform module that deploys the RFC8693 token broker as a Fargate
service behind the shared example-services ALB.

## Resources

- `aws_kms_key` `broker_signing` — asymmetric RSA-2048 KMS key reserved
  for a future migration to KMS-rooted JWT signing. Current broker code
  loads the PEM from Secrets Manager; the KMS key is provisioned now so
  the migration is a config-only change.
- `aws_secretsmanager_secret` `broker_signing_pem` — PEM PKCS8 private
  key (generated via the `tls` provider at apply time), KMS-encrypted
  with the secrets-module CMK. **`prevent_destroy = true`**.
- `aws_secretsmanager_secret` `actor_catalog` — JSON catalog of
  acting-service principals (client_id, hashed client_secret, allowed
  audiences, allowed scopes). Seeded with placeholder zero-hashes.
- `aws_cloudwatch_log_group` `/s2s/token-broker` (30-day retention).
- `aws_iam_role` `task` — broker Fargate task role with least-privilege
  `secretsmanager:GetSecretValue` on the two broker secrets,
  `kms:Decrypt` on the secrets CMK, and reserved `kms:Sign/Verify` on
  the broker_signing KMS key.
- `aws_iam_role` `execution` — Fargate execution role (ECR pull + logs).
- `aws_lb_target_group` + `aws_lb_listener_rule` `broker_oauth` —
  attaches to the existing example-services HTTP listener and forwards
  `/oauth2/*` and `/.well-known/*` (priority 3, above ledger=5 and
  receiving=10) to the broker.
- `aws_security_group` `broker` — ingress on port 4000 from the ALB SG
  only; egress open for ECR / Secrets Manager / KMS / Valkey.
- `aws_ecs_task_definition` + `aws_ecs_service` `broker` — 256/512
  Fargate, 2 desired tasks, read-only rootfs, runs as uid 1000.

## Bootstrap

After the first `terraform apply`, the actor-catalog secret contains
placeholder client-secret hashes. The token-broker will reject all
requests until real hashes are written:

```sh
# Compute the sha256 hex of each acting service's client_secret:
CALLING_HASH=sha256:$(printf '%s' "$CALLING_SERVICE_BROKER_SECRET" | shasum -a 256 | awk '{print $1}')
RECEIVING_HASH=sha256:$(printf '%s' "$RECEIVING_OUTBOUND_BROKER_SECRET" | shasum -a 256 | awk '{print $1}')

aws secretsmanager put-secret-value \
  --secret-id m2m/token-broker/actor-catalog \
  --secret-string "$(jq -n \
    --arg c "$CALLING_HASH" \
    --arg r "$RECEIVING_HASH" \
    '{
      "calling-service": {
        client_secret_hash: $c,
        allowed_audiences: ["receiving"],
        allowed_scopes: ["lending/read","lending/write"]
      },
      "receiving-service-outbound": {
        client_secret_hash: $r,
        allowed_audiences: ["ledger"],
        allowed_scopes: ["ledger/read","ledger/write"]
      }
    }')"
```

The broker should then be restarted (`aws ecs update-service ... --force-new-deployment`).

A rotation Lambda following the secrets-module pattern is a natural
next step; out of scope for Phase 6.

## Inputs

See `variables.tf`.

## Outputs

- `broker_url`, `broker_issuer`, `broker_token_endpoint`, `broker_jwks_uri`
- `signing_key_secret_arn`, `actor_catalog_secret_arn`, `kms_signing_key_arn`
- `task_role_arn`, `security_group_id`
