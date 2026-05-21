locals {
  broker_issuer_url       = "http://${var.alb_dns_name}"
  broker_token_endpoint   = "${local.broker_issuer_url}/oauth2/token"
  broker_jwks_uri         = "${local.broker_issuer_url}/.well-known/jwks.json"
  broker_image            = "${var.ecr_repository_url}:${var.image_tag}"
  broker_listener_pattern = ["/oauth2/*", "/.well-known/*"]
}

# --- KMS asymmetric signing key (for the broker's RSA-2048 JWT signing) ----
#
# The asymmetric KMS key is provisioned alongside the PEM-in-SM key so
# operators can later migrate the broker to KMS Sign for hardware-rooted
# signing. The current broker code loads a PEM private key from Secrets
# Manager; the KMS key is reserved for the migration.

resource "aws_kms_key" "broker_signing" {
  description              = "M2M token broker JWT signing key (asymmetric RSA-2048)"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "RSA_2048"
  deletion_window_in_days  = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "broker_signing" {
  name          = "alias/s2s-token-broker-signing"
  target_key_id = aws_kms_key.broker_signing.key_id
}

# --- Secrets Manager: broker signing key (PEM) ------------------------------

resource "tls_private_key" "broker_signing" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_secretsmanager_secret" "broker_signing_pem" {
  name        = "m2m/token-broker/signing-key"
  description = "Token broker JWT signing key (PEM PKCS8). Public key derived at runtime for JWKS."
  kms_key_id  = var.secrets_kms_key_arn

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret_version" "broker_signing_pem" {
  secret_id     = aws_secretsmanager_secret.broker_signing_pem.id
  secret_string = tls_private_key.broker_signing.private_key_pem
}

# --- Secrets Manager: actor catalog -----------------------------------------
#
# Seeded with placeholder hashes so the apply succeeds. Real
# sha256(client_secret) values must be populated post-bootstrap (see
# README — typically via `aws secretsmanager put-secret-value` once the
# calling-service and receiving-outbound clients have been provisioned in
# Cognito and their real secrets are known).

resource "aws_secretsmanager_secret" "actor_catalog" {
  name        = "m2m/token-broker/actor-catalog"
  description = "Token broker actor catalog (JSON: actor_client_id -> hashed secret + audience/scope allowlist)"
  kms_key_id  = var.secrets_kms_key_arn

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret_version" "actor_catalog_seed" {
  secret_id = aws_secretsmanager_secret.actor_catalog.id
  secret_string = jsonencode({
    "calling-service" = {
      client_secret_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
      allowed_audiences  = ["receiving"]
      allowed_scopes     = ["lending/read", "lending/write"]
    }
    "receiving-service-outbound" = {
      client_secret_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
      allowed_audiences  = ["ledger"]
      allowed_scopes     = ["ledger/read", "ledger/write"]
    }
  })
}

# --- IAM --------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name_prefix        = "s2s-broker-exec-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_ecr" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [var.ecr_repository_arn]
  }
}

resource "aws_iam_role_policy" "execution_ecr" {
  name   = "ecr-pull"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_ecr.json
}

resource "aws_iam_role" "task" {
  name_prefix        = "s2s-broker-task-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid = "ReadBrokerSecrets"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.broker_signing_pem.arn,
      aws_secretsmanager_secret.actor_catalog.arn,
    ]
  }

  statement {
    sid       = "DecryptViaSecretsCmk"
    actions   = ["kms:Decrypt"]
    resources = [var.secrets_kms_key_arn]
  }

  # Reserved for the future KMS Sign migration — the task can already
  # invoke Sign/Verify/GetPublicKey on the broker_signing CMK, but the
  # current broker code path uses the SM-stored PEM.
  statement {
    sid = "BrokerKmsSign"
    actions = [
      "kms:Sign",
      "kms:Verify",
      "kms:GetPublicKey",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.broker_signing.arn]
  }

  statement {
    sid = "ElastiCacheDescribe"
    actions = [
      "elasticache:DescribeCacheClusters",
      "elasticache:DescribeServerlessCaches",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "broker-task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# --- Logging ---------------------------------------------------------------

resource "aws_cloudwatch_log_group" "broker" {
  name              = "/s2s/token-broker"
  retention_in_days = var.log_retention_days
}

# --- Networking ------------------------------------------------------------

resource "aws_security_group" "broker" {
  name        = "s2s-token-broker"
  description = "Token broker Fargate tasks"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "egress for ECR / Secrets Manager / KMS / Valkey"
  }
}

resource "aws_security_group_rule" "broker_ingress_from_alb" {
  type                     = "ingress"
  from_port                = var.container_port
  to_port                  = var.container_port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.broker.id
  source_security_group_id = var.alb_security_group_id
  description              = "ALB to broker"
}

# --- ALB target group + listener rule --------------------------------------

resource "aws_lb_target_group" "broker" {
  name        = "s2s-broker-tg"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/health"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_lb_listener_rule" "broker_oauth" {
  listener_arn = var.alb_listener_arn
  # Lower priority number = higher precedence. Sits above ledger (5) so
  # the broker handles /oauth2/* and /.well-known/* before any other rule.
  priority = 3

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.broker.arn
  }

  condition {
    path_pattern {
      values = local.broker_listener_pattern
    }
  }
}

# --- ECS task definition + service -----------------------------------------

resource "aws_ecs_task_definition" "broker" {
  family                   = "s2s-token-broker"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name                   = "app"
    image                  = local.broker_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "1000:1000"
    portMappings           = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment = [
      { name = "PORT", value = tostring(var.container_port) },
      { name = "AWS_REGION", value = var.region },
      { name = "BROKER_ISSUER_URL", value = local.broker_issuer_url },
      { name = "BROKER_SIGNING_KEY_SECRET_ARN", value = aws_secretsmanager_secret.broker_signing_pem.arn },
      { name = "ACTOR_CATALOG_SECRET_ARN", value = aws_secretsmanager_secret.actor_catalog.arn },
      { name = "USER_ISSUER_URL", value = var.user_issuer_base_url },
      { name = "USER_ISSUER_AUDIENCE", value = var.user_issuer_audience },
      { name = "REDIS_ENDPOINT", value = var.redis_endpoint },
      { name = "DPOP_REQUIRED", value = "false" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.broker.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "broker"
      }
    }
  }])
}

resource "aws_ecs_service" "broker" {
  name             = "token-broker"
  cluster          = var.ecs_cluster_id
  task_definition  = aws_ecs_task_definition.broker.arn
  desired_count    = var.desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  enable_execute_command            = true
  health_check_grace_period_seconds = 60

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.broker.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.broker.arn
    container_name   = "app"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener_rule.broker_oauth]
}
