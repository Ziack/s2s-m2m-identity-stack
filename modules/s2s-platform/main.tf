locals {
  name_prefix = "${var.environment}-s2s"
  common_tags = merge(var.tags, {
    "s2s-managed" = "true"
    "environment" = var.environment
  })
  broker_base_url = "https://${aws_lb.this.dns_name}"
}

resource "aws_ecs_cluster" "this" {
  name = "${local.name_prefix}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.common_tags
}
