output "service_url" {
  value = "https://${var.platform.alb_dns_name}${trimsuffix(var.alb_path_pattern, "/*")}"
}

output "ecr_repository_uri" {
  value = aws_ecr_repository.this.repository_url
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.this.id
}

output "client_secret_arn" {
  value = aws_secretsmanager_secret.client_secret.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}

output "policy_arns" {
  value = [for p in aws_verifiedpermissions_policy.cedar : p.id]
}
