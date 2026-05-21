resource "tls_private_key" "broker_signing" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_secretsmanager_secret" "broker_signing" {
  name                    = "${local.name_prefix}/broker/signing-key"
  description             = "Token broker RSA private key (PEM)"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "broker_signing" {
  secret_id     = aws_secretsmanager_secret.broker_signing.id
  secret_string = tls_private_key.broker_signing.private_key_pem
}
