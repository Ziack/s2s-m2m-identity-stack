locals {
  name_prefix = "${var.platform.environment}-${var.service_name}"

  common_tags = merge(var.tags, {
    "s2s-managed"     = "true"
    "s2s-service"     = var.service_name
    "bounded-context" = var.bounded_context
    "environment"     = var.platform.environment
  })

  # Standard, platform-managed environment variables.
  platform_env = {
    COGNITO_DOMAIN            = var.platform.cognito_domain
    USER_POOL_ID              = var.platform.user_pool_id
    COGNITO_CLIENT_ID         = aws_cognito_user_pool_client.this.id
    COGNITO_CLIENT_SECRET_ARN = aws_secretsmanager_secret.client_secret.arn
    BROKER_URL                = var.platform.broker_url
    BROKER_JWKS_URI           = var.platform.broker_jwks_uri
    BROKER_ISSUER             = var.platform.broker_issuer
    BROKER_AUDIENCE           = var.bounded_context
    BROKER_TOKEN_ENDPOINT     = var.platform.broker_token_endpoint
    REDIS_ENDPOINT            = var.platform.redis_endpoint
    REDIS_PORT                = tostring(var.platform.redis_port)
    AVP_POLICY_STORE_ID       = var.platform.policy_store_id
    AVP_RESOURCE_SERVER       = var.platform.resource_server_identifier
    AWS_REGION                = var.platform.region
    OUTBOUND_AUDIENCES        = join(",", var.outbound_audiences)
  }

  merged_env_map = merge(local.platform_env, var.env)

  merged_env = [
    for k, v in local.merged_env_map : { name = k, value = v }
  ]

  # Filter platform sidecars by opt_out + opt_in for THIS service.
  applicable_sidecars = [
    for sc in var.platform.sidecars : sc
    if !contains(coalesce(sc.opt_out_services, []), var.service_name)
    && (length(coalesce(sc.opt_in_services, [])) == 0 || contains(sc.opt_in_services, var.service_name))
  ]

  applicable_sidecar_names = [for sc in local.applicable_sidecars : sc.name]

  applicable_iam_statements = [
    for stmt in var.platform.sidecar_iam_statements : stmt
    if contains(local.applicable_sidecar_names, stmt.sidecar_name)
  ]

  log_options = {
    awslogs-group         = aws_cloudwatch_log_group.this.name
    awslogs-region        = var.platform.region
    awslogs-stream-prefix = var.service_name
  }

  main_container = {
    name         = var.service_name
    image        = var.image_uri
    essential    = true
    portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment  = local.merged_env
    healthCheck = {
      command  = ["CMD-SHELL", "wget -q -O- http://localhost:${var.container_port}${var.health_check_path} || exit 1"]
      interval = 30
      timeout  = 5
      retries  = 3
    }
    logConfiguration       = { logDriver = "awslogs", options = local.log_options }
    readonlyRootFilesystem = true
    user                   = "1000:1000"
    linuxParameters        = { capabilities = { add = [], drop = ["ALL"] } }
  }

  all_containers = concat([local.main_container], local.applicable_sidecars)
}
