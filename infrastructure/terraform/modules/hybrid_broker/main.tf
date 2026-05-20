data "aws_availability_zones" "available" {
  count = length(var.availability_zones) == 0 ? 1 : 0
  state = "available"
}

locals {
  azs             = length(var.availability_zones) > 0 ? var.availability_zones : slice(data.aws_availability_zones.available[0].names, 0, 3)
  public_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 6, i + 10)]
}

# --- VPC + VGW ---------------------------------------------------------------

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "s2s-m2m-hybrid-hub" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "hub-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = local.azs[count.index]
  tags              = { Name = "hub-private-${count.index}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_vpn_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "s2s-m2m-vgw" }
}

resource "aws_customer_gateway" "onprem" {
  bgp_asn    = var.customer_bgp_asn
  ip_address = var.customer_vpn_gateway_ip
  type       = "ipsec.1"
  tags       = { Name = "s2s-m2m-cgw" }
}

resource "aws_vpn_connection" "site_to_site" {
  customer_gateway_id = aws_customer_gateway.onprem.id
  vpn_gateway_id      = aws_vpn_gateway.this.id
  type                = "ipsec.1"
  static_routes_only  = false
  tags                = { Name = "s2s-m2m-vpn" }
}

# Propagate VPN-learned routes into the private route table.
resource "aws_vpn_gateway_route_propagation" "private" {
  vpn_gateway_id = aws_vpn_gateway.this.id
  route_table_id = aws_route_table.private.id
}

# --- DynamoDB mapping table -------------------------------------------------

resource "aws_kms_key" "mapping" {
  description             = "DynamoDB hybrid mapping CMK"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "mapping" {
  name          = "alias/s2s-m2m-hybrid-mapping"
  target_key_id = aws_kms_key.mapping.key_id
}

resource "aws_dynamodb_table" "mapping" {
  name         = "s2s-m2m-hybrid-mapping"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "on_prem_id"

  attribute {
    name = "on_prem_id"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.mapping.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

# --- ECS cluster + Fargate service -----------------------------------------

resource "aws_cloudwatch_log_group" "broker" {
  name              = "/s2s/hybrid-broker"
  retention_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ecs_cluster" "this" {
  name = "s2s-m2m-hybrid-broker"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Internal ALB for broker
resource "aws_security_group" "alb" {
  name        = "s2s-m2m-broker-alb"
  description = "Internal ALB SG for hybrid broker"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr, var.onprem_cidr]
    description = "from VPC + on-prem"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "tasks" {
  name        = "s2s-m2m-broker-tasks"
  description = "Broker Fargate tasks"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "broker" {
  name               = "s2s-m2m-broker"
  internal           = true
  load_balancer_type = "application"
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "broker" {
  name        = "s2s-m2m-broker-tg"
  port        = 80
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id

  health_check {
    path                = "/"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "broker" {
  load_balancer_arn = aws_lb.broker.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.broker.arn
  }
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name_prefix        = "s2s-m2m-broker-exec-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name_prefix        = "s2s-m2m-broker-task-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task_ddb" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:BatchGetItem"]
    resources = [aws_dynamodb_table.mapping.arn]
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.mapping.arn]
  }
}

resource "aws_iam_role_policy" "task_ddb" {
  name   = "ddb-read"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_ddb.json
}

resource "aws_ecs_task_definition" "broker" {
  family                   = "s2s-m2m-hybrid-broker"
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "broker"
    image     = var.broker_image
    essential = true
    portMappings = [{
      containerPort = 80
      protocol      = "tcp"
    }]
    environment = [
      { name = "MAPPING_TABLE", value = aws_dynamodb_table.mapping.name },
      { name = "LOG_LEVEL", value = "info" },
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
  name             = "broker"
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.broker.arn
  desired_count    = var.broker_min_capacity
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.broker.arn
    container_name   = "broker"
    container_port   = 80
  }

  health_check_grace_period_seconds = 60

  depends_on = [aws_lb_listener.broker]

  lifecycle {
    ignore_changes = [desired_count]
  }
}

resource "aws_appautoscaling_target" "broker" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.broker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.broker_min_capacity
  max_capacity       = var.broker_max_capacity
}

resource "aws_appautoscaling_policy" "broker_cpu" {
  name               = "broker-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.broker.service_namespace
  resource_id        = aws_appautoscaling_target.broker.resource_id
  scalable_dimension = aws_appautoscaling_target.broker.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 65
    scale_in_cooldown  = 60
    scale_out_cooldown = 30

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
