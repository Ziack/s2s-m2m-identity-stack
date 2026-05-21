output "service_url" {
  value = module.hello_loans.service_url
}

output "ecr_repository_uri" {
  value = module.hello_loans.ecr_repository_uri
}

output "cognito_client_id" {
  value = module.hello_loans.cognito_client_id
}
