# Pass-through of every platform output, so operators can `terraform output`
# at this root without reaching into the module. The composite + SSM
# publication of these values is platform-side; this root just makes them
# visible.

# Identity plane
output "user_pool_id" { value = module.platform.user_pool_id }
output "user_pool_arn" { value = module.platform.user_pool_arn }
output "user_pool_endpoint" { value = module.platform.user_pool_endpoint }
output "cognito_domain" { value = module.platform.cognito_domain }

# Per-context maps
output "resource_server_identifiers" { value = module.platform.resource_server_identifiers }
output "policy_store_ids" { value = module.platform.policy_store_ids }
output "policy_store_arns" { value = module.platform.policy_store_arns }

# Broker plane
output "broker_url" { value = module.platform.broker_url }
output "broker_token_endpoint" { value = module.platform.broker_token_endpoint }
output "broker_jwks_uri" { value = module.platform.broker_jwks_uri }
output "broker_issuer" { value = module.platform.broker_issuer }

# Infra plane
output "kms_secrets_key_arn" { value = module.platform.kms_secrets_key_arn }
output "redis_endpoint" { value = module.platform.redis_endpoint }
output "redis_port" { value = module.platform.redis_port }
output "alb_listener_arn" { value = module.platform.alb_listener_arn }
output "alb_dns_name" { value = module.platform.alb_dns_name }
output "alb_security_group_id" { value = module.platform.alb_security_group_id }
output "workload_security_group_id" { value = module.platform.workload_security_group_id }
output "ecs_cluster_arn" { value = module.platform.ecs_cluster_arn }
output "ecs_cluster_name" { value = module.platform.ecs_cluster_name }
output "vpc_id" { value = module.platform.vpc_id }
output "private_subnet_ids" { value = module.platform.private_subnet_ids }

# Composite — the canonical `platform` object passed into s2s-service callers.
output "platform" { value = module.platform.platform }
