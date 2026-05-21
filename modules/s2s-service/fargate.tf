resource "aws_cloudwatch_log_group" "this" {
  name              = "/s2s/services/${var.service_name}"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.service_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions    = jsonencode(local.all_containers)

  dynamic "volume" {
    for_each = var.platform.sidecar_volumes
    content {
      name = volume.value.name
    }
  }

  tags = local.common_tags
}

resource "aws_ecs_service" "this" {
  name            = var.service_name
  cluster         = var.platform.ecs_cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.platform.private_subnet_ids
    security_groups = [var.platform.workload_security_group_id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = var.service_name
    container_port   = var.container_port
  }

  tags = local.common_tags
}
