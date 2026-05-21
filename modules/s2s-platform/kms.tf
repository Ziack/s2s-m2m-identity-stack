resource "aws_kms_key" "secrets" {
  description             = "${local.name_prefix} secrets CMK"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = local.common_tags
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${local.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_kms_key" "broker_signing" {
  description              = "${local.name_prefix} broker signing CMK (RSA-2048, reserved)"
  customer_master_key_spec = "RSA_2048"
  key_usage                = "SIGN_VERIFY"
  enable_key_rotation      = false
  deletion_window_in_days  = 30
  tags                     = local.common_tags
}

resource "aws_kms_alias" "broker_signing" {
  name          = "alias/${local.name_prefix}-broker-signing"
  target_key_id = aws_kms_key.broker_signing.key_id
}
