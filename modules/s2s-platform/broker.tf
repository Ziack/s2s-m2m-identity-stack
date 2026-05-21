resource "aws_cloudwatch_log_group" "broker" {
  name              = "/s2s/platform/broker"
  retention_in_days = var.broker_log_retention_days
  kms_key_id        = aws_kms_key.secrets.arn
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "audit" {
  name              = "/s2s/platform/audit"
  retention_in_days = var.broker_log_retention_days
  kms_key_id        = aws_kms_key.secrets.arn
  tags              = local.common_tags
}

data "aws_iam_policy_document" "broker_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "broker_execution" {
  name               = "${local.name_prefix}-broker-exec"
  assume_role_policy = data.aws_iam_policy_document.broker_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "broker_execution" {
  role       = aws_iam_role.broker_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "broker_task" {
  name               = "${local.name_prefix}-broker-task"
  assume_role_policy = data.aws_iam_policy_document.broker_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "broker_task" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.broker_signing.arn,
      aws_secretsmanager_secret.broker_actor_catalog.arn,
    ]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.secrets.arn]
  }
  statement {
    actions   = ["verifiedpermissions:IsAuthorizedWithToken", "verifiedpermissions:IsAuthorized"]
    resources = [for s in aws_verifiedpermissions_policy_store.contexts : s.arn]
  }
}

resource "aws_iam_role_policy" "broker_task" {
  role   = aws_iam_role.broker_task.id
  policy = data.aws_iam_policy_document.broker_task.json
}

resource "aws_ecs_task_definition" "broker" {
  family                   = "${local.name_prefix}-broker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.broker_execution.arn
  task_role_arn            = aws_iam_role.broker_task.arn

  container_definitions = jsonencode([
    {
      name                   = "broker"
      image                  = var.broker_image_uri
      essential              = true
      readonlyRootFilesystem = true
      user                   = "1000:1000"
      linuxParameters        = { capabilities = { add = [], drop = ["ALL"] } }
      portMappings           = [{ name = "broker-8080", containerPort = 8080, protocol = "tcp" }]
      environment = [
        { name = "BROKER_ISSUER_URL", value = local.broker_base_url },
        { name = "BROKER_SIGNING_KEY_SECRET_ARN", value = aws_secretsmanager_secret.broker_signing.arn },
        { name = "ACTOR_CATALOG_SECRET_ARN", value = aws_secretsmanager_secret.broker_actor_catalog.arn },
        { name = "USER_ISSUER_URL", value = var.user_issuer_url },
        { name = "USER_ISSUER_AUDIENCE", value = var.user_issuer_audience },
        { name = "REDIS_ENDPOINT", value = aws_elasticache_serverless_cache.this.endpoint[0].address },
        { name = "REDIS_PORT", value = tostring(aws_elasticache_serverless_cache.this.endpoint[0].port) },
        { name = "USER_POOL_ID", value = aws_cognito_user_pool.this.id },
        { name = "COGNITO_DOMAIN", value = aws_cognito_user_pool_domain.this.domain },
        { name = "AWS_REGION", value = var.region },
        { name = "PORT", value = "8080" },
      ]
      # `secrets = [...]` intentionally omitted — the broker fetches its own
      # secret values (signing key, actor catalog) via the task role using the
      # ARNs passed in via `environment` above. Letting ECS inject the secret
      # value as an env var would require the broker to also know the ARN
      # separately, and would defeat in-process caching/rotation in
      # signingKeyLoader.
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.broker.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "broker"
        }
      }
      healthCheck = {
        command  = ["CMD-SHELL", "wget -q -O- http://localhost:8080/health || exit 1"]
        interval = 30
        timeout  = 5
        retries  = 3
      }
    }
  ])

  tags = local.common_tags
}

resource "aws_lb_target_group" "broker" {
  name        = "${local.name_prefix}-broker-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "broker_oauth" {
  listener_arn = aws_lb_listener.this.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.broker.arn
  }
  condition {
    path_pattern {
      values = ["/oauth2/*"]
    }
  }
}

resource "aws_lb_listener_rule" "broker_wellknown" {
  listener_arn = aws_lb_listener.this.arn
  priority     = 11

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.broker.arn
  }
  condition {
    path_pattern {
      values = ["/.well-known/*"]
    }
  }
}

resource "aws_ecs_service" "broker" {
  name            = "${local.name_prefix}-broker"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.broker.arn
  desired_count   = var.broker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.workload.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.broker.arn
    container_name   = "broker"
    container_port   = 8080
  }

  # Register the broker tasks with the Lattice IP target group. Gated on
  # enable_lattice: when disabled the broker is ALB-only (v2.0.x behavior).
  # ECS assumes broker_lattice_infra to (de)register task IPs with Lattice.
  dynamic "vpc_lattice_configurations" {
    for_each = var.enable_lattice ? [1] : []
    content {
      role_arn         = aws_iam_role.broker_lattice_infra[0].arn
      target_group_arn = aws_vpclattice_target_group.broker[0].arn
      port_name        = "broker-8080"
    }
  }

  tags = local.common_tags
}
