output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_domain" {
  value = module.cognito.domain
}

output "cognito_lending_client_id" {
  value = module.cognito.lending_client_id
}

output "cognito_batch_client_id" {
  value = module.cognito.batch_client_id
}

output "secrets_lending_arn" {
  value = module.secrets.lending_secret_arn
}

output "valkey_endpoint" {
  value = module.elasticache.valkey_endpoint
}

output "valkey_port" {
  value = module.elasticache.valkey_port
}

output "workload_sg_id" {
  value = module.elasticache.workload_security_group_id
}

output "vpc_id" {
  value = module.elasticache.vpc_id
}

output "avp_lending_policy_store_id" {
  value = module.avp.lending_policy_store_id
}

output "lending_queue_url" {
  value = module.example_services.lending_queue_url
}

output "lending_queue_arn" {
  value = module.example_services.lending_queue_arn
}

output "alb_dns_name" {
  value = module.example_services.alb_dns_name
}

output "ecr_calling_uri" {
  value = module.ecr.calling_repo_uri
}

output "ecr_receiving_uri" {
  value = module.ecr.receiving_repo_uri
}
