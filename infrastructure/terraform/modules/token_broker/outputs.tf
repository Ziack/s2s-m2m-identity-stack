output "broker_url" {
  description = "Base URL where the broker is reachable (via the shared ALB)"
  value       = local.broker_issuer_url
}

output "broker_issuer" {
  description = "Broker issuer URL (matches BROKER_ISSUER_URL env)"
  value       = local.broker_issuer_url
}

output "broker_token_endpoint" {
  description = "Full URL of the broker's RFC8693 /oauth2/token endpoint"
  value       = local.broker_token_endpoint
}

output "broker_jwks_uri" {
  description = "Full URL of the broker's JWKS endpoint"
  value       = local.broker_jwks_uri
}

output "signing_key_secret_arn" {
  description = "Secrets Manager ARN of the broker JWT signing key PEM"
  value       = aws_secretsmanager_secret.broker_signing_pem.arn
}

output "actor_catalog_secret_arn" {
  description = "Secrets Manager ARN of the broker actor catalog JSON"
  value       = aws_secretsmanager_secret.actor_catalog.arn
}

output "kms_signing_key_arn" {
  description = "Reserved KMS asymmetric key for the future KMS-Sign-based broker"
  value       = aws_kms_key.broker_signing.arn
}

output "task_role_arn" {
  description = "Broker ECS task role ARN"
  value       = aws_iam_role.task.arn
}

output "security_group_id" {
  description = "Broker ECS task security group"
  value       = aws_security_group.broker.id
}
