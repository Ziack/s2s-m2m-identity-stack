resource "aws_secretsmanager_secret" "client_secret" {
  name                    = "${local.name_prefix}/cognito/client-secret"
  description             = "Cognito client secret for ${var.service_name}"
  kms_key_id              = var.platform.kms_secrets_key_arn
  recovery_window_in_days = 7
  tags                    = local.common_tags
}
