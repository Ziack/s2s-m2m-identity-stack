resource "aws_cognito_user_pool" "this" {
  name                     = "${local.name_prefix}-pool"
  mfa_configuration        = "OFF"
  auto_verified_attributes = []

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length    = 32
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_resource_server" "contexts" {
  for_each = toset(var.bounded_contexts)

  identifier   = each.value
  name         = each.value
  user_pool_id = aws_cognito_user_pool.this.id

  scope {
    scope_name        = "read"
    scope_description = "Read access to ${each.value}"
  }
  scope {
    scope_name        = "write"
    scope_description = "Write access to ${each.value}"
  }
}
