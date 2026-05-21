# Per-service VPC Lattice registration.
#
# Everything in this file is gated on BOTH:
#   - var.platform.enable_lattice  (the platform created the service network), AND
#   - var.register_with_lattice    (this service opts in; default true)
#
# When either is false NONE of these resources are created and the service stays
# ALB-only (exact v2.0.x behavior). When both are true, the service gets its own
# Lattice service with AWS_IAM auth (the SigV4-authenticated S2S path) in addition
# to the ALB.
#
# Ownership: the PLATFORM owns the service network + the broker's Lattice service.
# This module owns THIS service's Lattice service and registers it into the
# platform's service network. Mirrors modules/s2s-platform/lattice.tf (broker).

locals {
  service_lattice_enabled = (var.platform.enable_lattice && var.register_with_lattice) ? 1 : 0

  # Named container port mapping required by vpc_lattice_configurations.port_name.
  lattice_port_name = "${var.service_name}-${var.container_port}"
}

# --- Lattice service -------------------------------------------------------

resource "aws_vpclattice_service" "this" {
  count     = local.service_lattice_enabled
  name      = "${local.name_prefix}-svc"
  auth_type = "AWS_IAM"
  tags      = local.common_tags
}

resource "aws_vpclattice_service_network_service_association" "this" {
  count                      = local.service_lattice_enabled
  service_identifier         = aws_vpclattice_service.this[0].arn
  service_network_identifier = var.platform.lattice_service_network_id
  tags                       = local.common_tags
}

# IP target group fed by THIS service's Fargate tasks (registered by ECS via the
# vpc_lattice_configurations block on aws_ecs_service.this). The service speaks
# plain HTTP on var.container_port; Lattice terminates the listener and forwards
# to this TG. Health check matches the service's actual health path.
resource "aws_vpclattice_target_group" "this" {
  count = local.service_lattice_enabled
  name  = substr("${local.name_prefix}-lt", 0, 32)
  type  = "IP"

  config {
    port           = var.container_port
    protocol       = "HTTP"
    vpc_identifier = var.platform.vpc_id

    health_check {
      enabled  = true
      path     = var.health_check_path
      port     = var.container_port
      protocol = "HTTP"
    }
  }

  tags = local.common_tags
}

# Lattice terminates TLS at the service edge; the container only speaks plain
# HTTP on var.container_port, so the listener forwards over HTTP to the IP TG.
resource "aws_vpclattice_listener" "this" {
  count              = local.service_lattice_enabled
  name               = "http"
  service_identifier = aws_vpclattice_service.this[0].arn
  protocol           = "HTTP"
  port               = 80

  default_action {
    forward {
      target_groups {
        target_group_identifier = aws_vpclattice_target_group.this[0].id
        weight                  = 100
      }
    }
  }

  tags = local.common_tags
}

# Auth policy on this service. By default ALLOW vpc-lattice-svcs:Invoke from any
# principal in THIS account (network-layer defense-in-depth; the transport is
# still SigV4/IAM authenticated and account-scoped via aws:PrincipalAccount).
# DPoP + Cedar provide the real per-request authorization.
#
# TIGHTENING PATH: set var.lattice_allowed_caller_arns to the specific calling
# task-role ARNs to replace the account-wide condition with explicit Principal
# ARNs. Those ARNs belong to OTHER s2s-service instances (the callers), so the
# caller must publish its task_role_arn output and the consumer wires it here.
data "aws_iam_policy_document" "lattice_auth" {
  count = local.service_lattice_enabled

  statement {
    sid    = length(var.lattice_allowed_caller_arns) > 0 ? "AllowInvokeFromCallers" : "AllowInvokeFromAccount"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = length(var.lattice_allowed_caller_arns) > 0 ? var.lattice_allowed_caller_arns : ["*"]
    }

    actions   = ["vpc-lattice-svcs:Invoke"]
    resources = ["*"]

    dynamic "condition" {
      for_each = length(var.lattice_allowed_caller_arns) > 0 ? [] : [1]
      content {
        test     = "StringEquals"
        variable = "aws:PrincipalAccount"
        values   = [var.platform.account_id]
      }
    }
  }
}

resource "aws_vpclattice_auth_policy" "this" {
  count               = local.service_lattice_enabled
  resource_identifier = aws_vpclattice_service.this[0].arn
  policy              = data.aws_iam_policy_document.lattice_auth[0].json
}

# --- IAM for ECS-managed Lattice target registration -----------------------

# ECS registers/deregisters this service's task IPs with the Lattice target group.
# It assumes this role to call vpc-lattice:RegisterTargets / DeregisterTargets.
data "aws_iam_policy_document" "lattice_infra_assume" {
  count = local.service_lattice_enabled
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lattice_infra" {
  count              = local.service_lattice_enabled
  name               = substr("${local.name_prefix}-lt-infra", 0, 64)
  assume_role_policy = data.aws_iam_policy_document.lattice_infra_assume[0].json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "lattice_infra" {
  count = local.service_lattice_enabled
  statement {
    actions = [
      "vpc-lattice:RegisterTargets",
      "vpc-lattice:DeregisterTargets",
      "vpc-lattice:ListTargets",
      "vpc-lattice:GetTargetGroup",
      "vpc-lattice:ListTargetGroups",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lattice_infra" {
  count  = local.service_lattice_enabled
  role   = aws_iam_role.lattice_infra[0].id
  policy = data.aws_iam_policy_document.lattice_infra[0].json
}
