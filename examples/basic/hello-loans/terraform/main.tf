data "aws_ssm_parameter" "platform" {
  for_each = toset([
    "user_pool_id", "cognito_domain",
    "broker_url", "broker_jwks_uri", "broker_token_endpoint", "broker_issuer",
    "kms_secrets_key_arn", "redis_endpoint", "redis_port",
    "alb_dns_name", "alb_listener_arn", "alb_security_group_id",
    "workload_security_group_id", "ecs_cluster_arn", "ecs_cluster_name",
    "vpc_id", "private_subnet_ids",
    "policy_store_ids", "resource_server_identifiers",
  ])
  name = "/${var.environment}/s2s/platform/${each.value}"
}

locals {
  platform = {
    account_id                 = var.account_id
    region                     = var.region
    environment                = var.environment
    user_pool_id               = data.aws_ssm_parameter.platform["user_pool_id"].value
    cognito_domain             = data.aws_ssm_parameter.platform["cognito_domain"].value
    broker_url                 = data.aws_ssm_parameter.platform["broker_url"].value
    broker_jwks_uri            = data.aws_ssm_parameter.platform["broker_jwks_uri"].value
    broker_token_endpoint      = data.aws_ssm_parameter.platform["broker_token_endpoint"].value
    broker_issuer              = data.aws_ssm_parameter.platform["broker_issuer"].value
    kms_secrets_key_arn        = data.aws_ssm_parameter.platform["kms_secrets_key_arn"].value
    redis_endpoint             = data.aws_ssm_parameter.platform["redis_endpoint"].value
    redis_port                 = tonumber(data.aws_ssm_parameter.platform["redis_port"].value)
    alb_dns_name               = data.aws_ssm_parameter.platform["alb_dns_name"].value
    alb_listener_arn           = data.aws_ssm_parameter.platform["alb_listener_arn"].value
    alb_security_group_id      = data.aws_ssm_parameter.platform["alb_security_group_id"].value
    workload_security_group_id = data.aws_ssm_parameter.platform["workload_security_group_id"].value
    ecs_cluster_arn            = data.aws_ssm_parameter.platform["ecs_cluster_arn"].value
    ecs_cluster_name           = data.aws_ssm_parameter.platform["ecs_cluster_name"].value
    vpc_id                     = data.aws_ssm_parameter.platform["vpc_id"].value
    private_subnet_ids         = split(",", data.aws_ssm_parameter.platform["private_subnet_ids"].value)
    policy_store_id            = jsondecode(data.aws_ssm_parameter.platform["policy_store_ids"].value)[var.bounded_context]
    resource_server_identifier = jsondecode(data.aws_ssm_parameter.platform["resource_server_identifiers"].value)[var.bounded_context]
    sidecars                   = []
    sidecar_iam_statements     = []
    sidecar_volumes            = []
  }
}

module "hello_loans" {
  source = "../../../../modules/s2s-service"

  platform = local.platform

  service_name               = "hello-loans"
  bounded_context            = var.bounded_context
  scopes                     = ["lending/read"]
  image_uri                  = "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.environment}/hello-loans:${var.image_tag}"
  container_port             = 3000
  alb_path_pattern           = "/api/hello*"
  alb_listener_rule_priority = 50
  desired_count              = 1

  cedar_policies = [
    {
      name        = "permit-hello-by-lending"
      statement   = file("${path.module}/../policies/lending.cedar")
      description = "Permit any lending caller to invoke /api/hello"
    },
  ]

  outbound_audiences = []

  env = {
    LOG_LEVEL = "info"
  }

  tags = {
    example     = "basic"
    environment = var.environment
  }
}
