output "service_url" {
  value = module.receiving_service.service_url
}

output "ecr_repository_uri" {
  value = module.receiving_service.ecr_repository_uri
}

output "cognito_client_id" {
  value = module.receiving_service.cognito_client_id
}

output "client_secret_arn" {
  value = module.receiving_service.client_secret_arn
}
