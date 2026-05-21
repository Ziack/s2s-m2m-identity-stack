output "service_url" {
  value = module.loan_origination.service_url
}

output "ecr_repository_uri" {
  value = module.loan_origination.ecr_repository_uri
}

output "cognito_client_id" {
  value = module.loan_origination.cognito_client_id
}

output "client_secret_arn" {
  value = module.loan_origination.client_secret_arn
}
