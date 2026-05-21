output "service_url" {
  # Derived from the first effective path pattern (the primary route for the service).
  value = "https://${var.platform.alb_dns_name}${trimsuffix(local.effective_alb_path_patterns[0], "/*")}"
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

output "policy_ids" {
  description = "List of Cedar policy IDs created in the platform's AVP policy store for this service's bounded_context"
  value       = [for p in aws_verifiedpermissions_policy.cedar : p.id]
}

output "lattice_service_dns" {
  description = "This service's VPC Lattice DNS name. Null when the service is not registered with Lattice (platform disabled or register_with_lattice = false)."
  value       = local.service_lattice_enabled == 1 ? aws_vpclattice_service.this[0].dns_entry[0].domain_name : null
}

output "lattice_service_arn" {
  description = "This service's VPC Lattice service ARN. Callers can use it to tighten their own task-role Invoke policies or this service's auth policy via lattice_allowed_caller_arns. Null when not registered."
  value       = local.service_lattice_enabled == 1 ? aws_vpclattice_service.this[0].arn : null
}
