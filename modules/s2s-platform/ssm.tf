locals {
  ssm_prefix = "/${var.environment}/s2s/platform"

  ssm_scalars = {
    user_pool_id               = aws_cognito_user_pool.this.id
    user_pool_arn              = aws_cognito_user_pool.this.arn
    user_pool_endpoint         = aws_cognito_user_pool.this.endpoint
    cognito_domain             = aws_cognito_user_pool_domain.this.domain
    broker_url                 = local.broker_base_url
    broker_token_endpoint      = "${local.broker_base_url}/oauth2/token"
    broker_jwks_uri            = "${local.broker_base_url}/.well-known/jwks.json"
    broker_issuer              = local.broker_base_url
    kms_secrets_key_arn        = aws_kms_key.secrets.arn
    redis_endpoint             = aws_elasticache_serverless_cache.this.endpoint[0].address
    redis_port                 = tostring(aws_elasticache_serverless_cache.this.endpoint[0].port)
    alb_listener_arn           = aws_lb_listener.this.arn
    alb_dns_name               = aws_lb.this.dns_name
    alb_security_group_id      = aws_security_group.alb.id
    workload_security_group_id = aws_security_group.workload.id
    ecs_cluster_arn            = aws_ecs_cluster.this.arn
    ecs_cluster_name           = aws_ecs_cluster.this.name
    vpc_id                     = var.vpc_id
  }

  ssm_json_maps = {
    resource_server_identifiers = jsonencode({ for c in var.bounded_contexts : c => aws_cognito_resource_server.contexts[c].identifier })
    policy_store_ids            = jsonencode({ for c in var.bounded_contexts : c => aws_verifiedpermissions_policy_store.contexts[c].id })
    policy_store_arns           = jsonencode({ for c in var.bounded_contexts : c => aws_verifiedpermissions_policy_store.contexts[c].arn })
  }
}

resource "aws_ssm_parameter" "scalars" {
  for_each = local.ssm_scalars
  name     = "${local.ssm_prefix}/${each.key}"
  type     = "String"
  value    = each.value
  tags     = local.common_tags
}

resource "aws_ssm_parameter" "private_subnet_ids" {
  name  = "${local.ssm_prefix}/private_subnet_ids"
  type  = "StringList"
  value = join(",", var.private_subnet_ids)
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "bounded_contexts" {
  name  = "${local.ssm_prefix}/bounded_contexts"
  type  = "StringList"
  value = length(var.bounded_contexts) > 0 ? join(",", var.bounded_contexts) : "none"
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "json_maps" {
  for_each = local.ssm_json_maps
  name     = "${local.ssm_prefix}/${each.key}"
  type     = "String"
  value    = each.value
  tags     = local.common_tags
}
