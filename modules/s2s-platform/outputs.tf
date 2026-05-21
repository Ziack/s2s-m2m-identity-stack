# Identity plane
output "user_pool_id" { value = aws_cognito_user_pool.this.id }
output "user_pool_arn" { value = aws_cognito_user_pool.this.arn }
output "user_pool_endpoint" { value = aws_cognito_user_pool.this.endpoint }
output "cognito_domain" { value = aws_cognito_user_pool_domain.this.domain }

# Per-context maps
output "resource_server_identifiers" {
  value = { for c in var.bounded_contexts : c => aws_cognito_resource_server.contexts[c].identifier }
}
output "policy_store_ids" {
  value = { for c in var.bounded_contexts : c => aws_verifiedpermissions_policy_store.contexts[c].id }
}
output "policy_store_arns" {
  value = { for c in var.bounded_contexts : c => aws_verifiedpermissions_policy_store.contexts[c].arn }
}

# Broker plane
output "broker_url" { value = local.broker_base_url }
output "broker_token_endpoint" { value = "${local.broker_base_url}/oauth2/token" }
output "broker_jwks_uri" { value = "${local.broker_base_url}/.well-known/jwks.json" }
output "broker_issuer" { value = local.broker_base_url }
output "actor_catalog_secret_arn" { value = aws_secretsmanager_secret.broker_actor_catalog.arn }

# Lattice plane (null/empty when enable_lattice = false)
output "lattice_service_network_id" {
  value = var.enable_lattice ? aws_vpclattice_service_network.this[0].id : null
}
output "lattice_service_network_arn" {
  value = var.enable_lattice ? aws_vpclattice_service_network.this[0].arn : null
}
output "broker_lattice_dns" {
  value = var.enable_lattice ? aws_vpclattice_service.broker[0].dns_entry[0].domain_name : null
}

# Infra plane
output "kms_secrets_key_arn" { value = aws_kms_key.secrets.arn }
output "redis_endpoint" { value = aws_elasticache_serverless_cache.this.endpoint[0].address }
output "redis_port" { value = aws_elasticache_serverless_cache.this.endpoint[0].port }
output "alb_listener_arn" { value = aws_lb_listener.this.arn }
output "alb_dns_name" { value = aws_lb.this.dns_name }
output "alb_security_group_id" { value = aws_security_group.alb.id }
output "workload_security_group_id" { value = aws_security_group.workload.id }
output "ecs_cluster_arn" { value = aws_ecs_cluster.this.arn }
output "ecs_cluster_name" { value = aws_ecs_cluster.this.name }
output "vpc_id" { value = var.vpc_id }
output "private_subnet_ids" { value = var.private_subnet_ids }

# Composite — frozen contract consumed by s2s-service
output "platform" {
  value = {
    account_id                 = var.account_id
    region                     = var.region
    environment                = var.environment
    user_pool_id               = aws_cognito_user_pool.this.id
    cognito_domain             = aws_cognito_user_pool_domain.this.domain
    broker_url                 = local.broker_base_url
    broker_jwks_uri            = "${local.broker_base_url}/.well-known/jwks.json"
    broker_token_endpoint      = "${local.broker_base_url}/oauth2/token"
    broker_issuer              = local.broker_base_url
    kms_secrets_key_arn        = aws_kms_key.secrets.arn
    redis_endpoint             = aws_elasticache_serverless_cache.this.endpoint[0].address
    redis_port                 = aws_elasticache_serverless_cache.this.endpoint[0].port
    alb_dns_name               = aws_lb.this.dns_name
    alb_listener_arn           = aws_lb_listener.this.arn
    alb_security_group_id      = aws_security_group.alb.id
    workload_security_group_id = aws_security_group.workload.id
    ecs_cluster_arn            = aws_ecs_cluster.this.arn
    ecs_cluster_name           = aws_ecs_cluster.this.name
    vpc_id                     = var.vpc_id
    private_subnet_ids         = var.private_subnet_ids
    enable_lattice             = var.enable_lattice
    lattice_service_network_id = var.enable_lattice ? aws_vpclattice_service_network.this[0].id : null
    broker_lattice_dns         = var.enable_lattice ? aws_vpclattice_service.broker[0].dns_entry[0].domain_name : null
    sidecars                   = local.platform_sidecars
    sidecar_iam_statements     = local.platform_sidecar_iam_statements
    sidecar_volumes            = local.platform_sidecar_volumes
  }
}
