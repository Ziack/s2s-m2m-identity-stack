output "service_url" {
  value = module.ledger_service.service_url
}

output "ecr_repository_uri" {
  value = module.ledger_service.ecr_repository_uri
}

output "cognito_client_id" {
  value = module.ledger_service.cognito_client_id
}

output "lattice_service_dns" {
  description = "This service's VPC Lattice DNS (null when Lattice disabled / not registered)."
  value       = module.ledger_service.lattice_service_dns
}
