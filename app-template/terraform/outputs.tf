output "service_url" {
  value       = module.s2s_service.service_url
  description = "Public(-internal) URL of the deployed service"
}

output "ecr_repository_uri" {
  value       = module.s2s_service.ecr_repository_uri
  description = "Repo URI to push images to"
}

output "cognito_client_id" {
  value       = module.s2s_service.cognito_client_id
  description = "Cognito app client ID for outbound actor authentication"
}

output "task_role_arn" {
  value       = module.s2s_service.task_role_arn
  description = "ARN of the task IAM role"
}
