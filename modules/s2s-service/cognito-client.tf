resource "aws_cognito_user_pool_client" "this" {
  name         = var.service_name
  user_pool_id = var.platform.user_pool_id

  generate_secret                      = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = var.scopes
  supported_identity_providers         = ["COGNITO"]

  # No user-facing flows
  explicit_auth_flows = []
}

# Capture the Cognito-generated client secret into Secrets Manager.
resource "aws_secretsmanager_secret_version" "client_secret" {
  secret_id     = aws_secretsmanager_secret.client_secret.id
  secret_string = aws_cognito_user_pool_client.this.client_secret
}
