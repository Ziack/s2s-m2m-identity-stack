output "service_url" {
  value = module.calling_service.service_url
}

output "ecr_repository_uri" {
  value = module.calling_service.ecr_repository_uri
}

output "cognito_client_id" {
  value = module.calling_service.cognito_client_id
}

output "client_secret_arn" {
  value = module.calling_service.client_secret_arn
}
