resource "tls_private_key" "broker_signing" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_secretsmanager_secret" "broker_signing" {
  name                    = "${local.name_prefix}/broker/signing-key"
  description             = "Token broker RSA private key (PKCS#8 PEM)"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "broker_signing" {
  secret_id = aws_secretsmanager_secret.broker_signing.id
  # The broker's signingKeyLoader.ts calls importPKCS8(...), so the key MUST be
  # stored in PKCS#8 form. `private_key_pem` is PKCS#1 for RSA keys and would
  # fail to import — use `private_key_pem_pkcs8`.
  secret_string = tls_private_key.broker_signing.private_key_pem_pkcs8
}

# Actor catalog — the broker reads this on boot for client_secret_basic
# verification. We provision it with a placeholder body; the orchestrator
# (examples/chained/e2e/src/scripts/deploy-and-test.sh step 6) overwrites the
# body with real sha256 hashes after the per-service Cognito client_secrets
# land. The broker must be redeployed (force-new-deployment) for the new
# value to be loaded (the catalog is read once at startup).
resource "aws_secretsmanager_secret" "broker_actor_catalog" {
  name                    = "${var.environment}-s2s/platform/broker/actor-catalog"
  description             = "Actor catalog consumed by the token broker for client_secret_basic verification. Body managed out-of-band by the orchestrator."
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 0
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "broker_actor_catalog_placeholder" {
  secret_id = aws_secretsmanager_secret.broker_actor_catalog.id
  # Empty catalog — valid JSON object the broker accepts, but allows zero
  # actors to authenticate until the orchestrator populates real entries.
  # An empty `{}` is parsed by loadActorCatalog as a zero-entry catalog, so
  # the broker boots successfully on first deploy and only starts accepting
  # token-exchange requests after step 6 fills in the real hashes.
  secret_string = jsonencode({})
  lifecycle {
    # Don't fight the orchestrator's manual updates of the catalog body.
    ignore_changes = [secret_string]
  }
}
