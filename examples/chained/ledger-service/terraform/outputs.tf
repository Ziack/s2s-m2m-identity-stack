output "service_url" {
  value = module.ledger_service.service_url
}

output "ecr_repository_uri" {
  value = module.ledger_service.ecr_repository_uri
}

output "cognito_client_id" {
  value = module.ledger_service.cognito_client_id
}
