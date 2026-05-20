output "kms_key_arn" {
  value = aws_kms_key.secrets.arn
}

output "secret_arns" {
  description = "Map of bounded-context -> Secrets Manager secret ARN"
  value       = { for ctx, s in aws_secretsmanager_secret.context : ctx => s.arn }
}

output "lending_secret_arn" {
  value = aws_secretsmanager_secret.context["lending"].arn
}

output "ledger_secret_arn" {
  value = aws_secretsmanager_secret.context["ledger"].arn
}

output "receiving_outbound_secret_arn" {
  value = aws_secretsmanager_secret.receiving_outbound.arn
}

output "rotation_lambda_arn" {
  value = aws_lambda_function.rotation.arn
}
