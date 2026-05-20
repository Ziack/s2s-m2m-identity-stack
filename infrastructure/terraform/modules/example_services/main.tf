locals {
  policy_store_arn = "arn:aws:verifiedpermissions::${var.account_id}:policy-store/${var.avp_lending_policy_store_id}"
  calling_image    = "${replace(var.calling_repo_arn, "arn:aws:ecr:${var.region}:${var.account_id}:repository/", "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/")}:${var.image_tag}"
  receiving_image  = "${replace(var.receiving_repo_arn, "arn:aws:ecr:${var.region}:${var.account_id}:repository/", "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/")}:${var.image_tag}"
}

# --- SQS: lending decisions queue + DLQ -------------------------------------

resource "aws_sqs_queue" "lending_dlq" {
  name                              = "lending-decisions-dlq"
  message_retention_seconds         = 1209600 # 14 days
  kms_master_key_id                 = var.kms_cmk_arn
  kms_data_key_reuse_period_seconds = 300

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_sqs_queue" "lending" {
  name                              = "lending-decisions"
  visibility_timeout_seconds        = 30
  message_retention_seconds         = 345600 # 4 days
  kms_master_key_id                 = var.kms_cmk_arn
  kms_data_key_reuse_period_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.lending_dlq.arn
    maxReceiveCount     = 5
  })

  lifecycle {
    prevent_destroy = true
  }
}

# --- IAM: task + execution roles --------------------------------------------

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
  name_prefix        = "s2s-svc-exec-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_ecr" {
  statement {
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }
  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [var.calling_repo_arn, var.receiving_repo_arn]
  }
}

resource "aws_iam_role_policy" "execution_ecr" {
  name   = "ecr-pull"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_ecr.json
}

# Calling task role: secret read, SQS send, AVP IsAuthorizedWithToken, ElastiCache describe
resource "aws_iam_role" "calling_task" {
  name_prefix        = "s2s-calling-task-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "calling_task" {
  statement {
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [var.lending_client_secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_cmk_arn]
  }
  statement {
    actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
    resources = [aws_sqs_queue.lending.arn]
  }
  statement {
    actions   = ["verifiedpermissions:IsAuthorizedWithToken"]
    resources = [local.policy_store_arn]
  }
  statement {
    actions   = ["elasticache:DescribeCacheClusters", "elasticache:DescribeServerlessCaches"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "calling_task" {
  name   = "calling-task"
  role   = aws_iam_role.calling_task.id
  policy = data.aws_iam_policy_document.calling_task.json
}

# Receiving task role: secret read, SQS consume, AVP, ElastiCache describe
resource "aws_iam_role" "receiving_task" {
  name_prefix        = "s2s-receiving-task-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "receiving_task" {
  statement {
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [var.lending_client_secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_cmk_arn]
  }
  statement {
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [aws_sqs_queue.lending.arn]
  }
  statement {
    actions   = ["verifiedpermissions:IsAuthorizedWithToken"]
    resources = [local.policy_store_arn]
  }
  statement {
    actions   = ["elasticache:DescribeCacheClusters", "elasticache:DescribeServerlessCaches"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "receiving_task" {
  name   = "receiving-task"
  role   = aws_iam_role.receiving_task.id
  policy = data.aws_iam_policy_document.receiving_task.json
}

# --- ECS cluster + log groups -----------------------------------------------

resource "aws_ecs_cluster" "this" {
  name = "s2s-s2s-poc"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/s2s/cluster"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "calling" {
  name              = "/s2s/calling-service"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "receiving" {
  name              = "/s2s/receiving-service"
  retention_in_days = 30
}

# --- ALB --------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "s2s-svc-alb"
  description = "Internal ALB for calling+receiving services"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group_rule" "alb_ingress_from_workload" {
  type                     = "ingress"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  security_group_id        = aws_security_group.alb.id
  source_security_group_id = var.workload_security_group_id
  description              = "workload to ALB"
}

resource "aws_lb" "this" {
  name               = "s2s-svc-alb"
  internal           = true
  load_balancer_type = "application"
  subnets            = var.private_subnet_ids
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not_found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_target_group" "receiving" {
  name        = "s2s-receiving-tg"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/health"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "calling" {
  name        = "s2s-calling-tg"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/health"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "receiving" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.receiving.arn
  }

  condition {
    path_pattern {
      values = ["/api/*", "/health", "/health/auth"]
    }
  }
}

resource "aws_lb_listener_rule" "calling" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.calling.arn
  }

  condition {
    path_pattern {
      values = ["/demo/*", "/metrics", "/.well-known/*"]
    }
  }
}

# --- Task definitions + services -------------------------------------------

resource "aws_ecs_task_definition" "calling" {
  family                   = "s2s-calling-service"
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.calling_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name                   = "app"
    image                  = local.calling_image
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "PORT", value = "3000" },
      { name = "AWS_REGION", value = var.region },
      { name = "COGNITO_CLIENT_ID", value = var.lending_client_id },
      { name = "COGNITO_DOMAIN", value = var.cognito_domain },
      { name = "M2M_CLIENT_SECRET_ARN", value = var.lending_client_secret_arn },
      { name = "REDIS_ENDPOINT", value = var.redis_endpoint },
      { name = "AVP_POLICY_STORE_ID", value = var.avp_lending_policy_store_id },
      { name = "TARGET_AUDIENCE", value = "lending" },
      { name = "TARGET_SCOPES", value = "lending/read,lending/write" },
      { name = "LENDING_QUEUE_URL", value = aws_sqs_queue.lending.url },
      { name = "LENDING_QUEUE_ARN", value = aws_sqs_queue.lending.arn },
      { name = "TARGET_BASE_URL", value = "http://${aws_lb.this.dns_name}" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.calling.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "calling"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "receiving" {
  family                   = "s2s-receiving-service"
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.receiving_task.arn

  container_definitions = jsonencode([{
    name                   = "app"
    image                  = local.receiving_image
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "PORT", value = "3000" },
      { name = "AWS_REGION", value = var.region },
      { name = "COGNITO_CLIENT_ID", value = var.lending_client_id },
      { name = "COGNITO_DOMAIN", value = var.cognito_domain },
      { name = "M2M_CLIENT_SECRET_ARN", value = var.lending_client_secret_arn },
      { name = "REDIS_ENDPOINT", value = var.redis_endpoint },
      { name = "AVP_POLICY_STORE_ID", value = var.avp_lending_policy_store_id },
      { name = "EXPECTED_AUDIENCE", value = "lending" },
      { name = "RESOURCE_PREFIX", value = "lending" },
      { name = "LENDING_QUEUE_URL", value = aws_sqs_queue.lending.url },
      { name = "LENDING_QUEUE_ARN", value = aws_sqs_queue.lending.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.receiving.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "receiving"
      }
    }
  }])
}

resource "aws_ecs_service" "calling" {
  name             = "calling-service"
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.calling.arn
  desired_count    = 2
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  enable_execute_command = true

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.workload_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.calling.arn
    container_name   = "app"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener_rule.calling]
}

resource "aws_ecs_service" "receiving" {
  name             = "receiving-service"
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.receiving.arn
  desired_count    = 2
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  enable_execute_command = true

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.workload_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.receiving.arn
    container_name   = "app"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener_rule.receiving]
}
