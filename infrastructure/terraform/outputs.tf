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

output "ecr_ledger_uri" {
  value = module.ecr.ledger_repo_uri
}

output "cognito_ledger_client_id" {
  value = module.cognito.ledger_client_id
}

output "cognito_receiving_outbound_client_id" {
  value = module.cognito.receiving_outbound_client_id
}

output "secrets_ledger_arn" {
  value = module.secrets.ledger_secret_arn
}

output "secrets_receiving_outbound_arn" {
  value = module.secrets.receiving_outbound_secret_arn
}

output "avp_ledger_policy_store_id" {
  value = module.avp.ledger_policy_store_id
}

# --- Token broker / user issuer (Phase 6) -----------------------------------

output "broker_url" {
  value = module.token_broker.broker_url
}

output "broker_token_endpoint" {
  value = module.token_broker.broker_token_endpoint
}

output "broker_jwks_uri" {
  value = module.token_broker.broker_jwks_uri
}

output "broker_issuer" {
  value = module.token_broker.broker_issuer
}

output "broker_signing_key_secret_arn" {
  value = module.token_broker.signing_key_secret_arn
}

output "broker_actor_catalog_secret_arn" {
  value = module.token_broker.actor_catalog_secret_arn
}

output "user_issuer_signing_secret_arn" {
  value = module.secrets.user_issuer_signing_secret_arn
}

output "ecr_broker_uri" {
  value = module.ecr.broker_repo_uri
}
