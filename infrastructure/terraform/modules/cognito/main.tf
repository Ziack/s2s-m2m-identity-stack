resource "aws_cognito_user_pool" "this" {
  name = "s2s-m2m-identity"

  # advanced security = ENFORCED via user pool add-on
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_resource_server" "context" {
  for_each = toset(var.bounded_contexts)

  user_pool_id = aws_cognito_user_pool.this.id
  identifier   = each.key
  name         = each.key

  scope {
    scope_name        = "read"
    scope_description = format("Read %s resources", each.key)
  }
  scope {
    scope_name        = "write"
    scope_description = format("Write %s resources", each.key)
  }
}

# Dedicated outbound client used by receiving-service to call the ledger
# service. DPoP is sender-constrained, so each hop is an independent OAuth
# client; this is the receiving-side credential, scoped to ledger/write.
resource "aws_cognito_user_pool_client" "receiving_outbound" {
  user_pool_id    = aws_cognito_user_pool.this.id
  name            = "receiving-service-outbound"
  generate_secret = true

  access_token_validity  = 5
  id_token_validity      = 5
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"

  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["ledger/write"]

  explicit_auth_flows = []

  depends_on = [aws_cognito_resource_server.context]
}

resource "aws_cognito_user_pool_client" "context" {
  for_each = toset(var.bounded_contexts)

  user_pool_id    = aws_cognito_user_pool.this.id
  name            = "${each.key}-service"
  generate_secret = true

  access_token_validity  = 5
  id_token_validity      = 5
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"

  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes = [
    "${each.key}/read",
    "${each.key}/write",
  ]

  explicit_auth_flows = []

  depends_on = [aws_cognito_resource_server.context]
}

resource "aws_cognito_user_pool_client" "batch_processor" {
  user_pool_id    = aws_cognito_user_pool.this.id
  name            = "batch-processor"
  generate_secret = true

  access_token_validity  = 5
  id_token_validity      = 5
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"

  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes = [
    "lending/read",
    "lending/write",
  ]

  explicit_auth_flows = []

  depends_on = [aws_cognito_resource_server.context]
}
