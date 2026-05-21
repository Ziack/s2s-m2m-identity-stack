output "service_url" {
  value = module.loan_servicing.service_url
}

output "ecr_repository_uri" {
  value = module.loan_servicing.ecr_repository_uri
}

output "cognito_client_id" {
  value = module.loan_servicing.cognito_client_id
}

output "client_secret_arn" {
  value = module.loan_servicing.client_secret_arn
}
