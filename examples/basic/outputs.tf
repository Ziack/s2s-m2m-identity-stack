output "service_url" {
  value = module.loan_origination.service_url
}

output "ecr_repository_uri" {
  value = module.loan_origination.ecr_repository_uri
}

output "task_role_arn" {
  value = module.loan_origination.task_role_arn
}
