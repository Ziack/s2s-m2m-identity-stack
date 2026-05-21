# VPC Lattice service-to-service plane.
#
# Everything in this file is gated on var.enable_lattice. When false, NONE of
# these resources are created and the broker stays ALB-only (exact v2.0.x
# behavior). When true, the broker is reachable over BOTH the ALB (direct/debug)
# and a VPC Lattice service with AWS_IAM auth (the SigV4-authenticated S2S path).
#
# Ownership: the PLATFORM owns the service network + the broker's Lattice
# service. Each app service's own Lattice service is owned by the s2s-service
# module (Phase 3).

locals {
  lattice_enabled = var.enable_lattice ? 1 : 0
}

# --- Service network -------------------------------------------------------

resource "aws_vpclattice_service_network" "this" {
  count     = local.lattice_enabled
  name      = "${local.name_prefix}-net"
  auth_type = "AWS_IAM"
  tags      = local.common_tags
}

# Associate the workload VPC so tasks can resolve + reach Lattice service DNS.
# The workload SG is attached so Lattice ingress is constrained to workload tasks.
resource "aws_vpclattice_service_network_vpc_association" "this" {
  count                      = local.lattice_enabled
  vpc_identifier             = var.vpc_id
  service_network_identifier = aws_vpclattice_service_network.this[0].id
  security_group_ids         = [aws_security_group.workload.id]
  tags                       = local.common_tags
}

# --- Access logs -----------------------------------------------------------

resource "aws_s3_bucket" "lattice_logs" {
  count         = local.lattice_enabled
  bucket        = "${local.name_prefix}-lattice-logs-${var.account_id}-${var.region}"
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }

  tags = local.common_tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lattice_logs" {
  count  = local.lattice_enabled
  bucket = aws_s3_bucket.lattice_logs[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.secrets.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "lattice_logs" {
  count                   = local.lattice_enabled
  bucket                  = aws_s3_bucket.lattice_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudwatch_log_group" "lattice_access" {
  count             = local.lattice_enabled
  name              = "/aws/vpclattice/${local.name_prefix}"
  retention_in_days = var.broker_log_retention_days
  kms_key_id        = aws_kms_key.secrets.arn
  tags              = local.common_tags
}

resource "aws_vpclattice_access_log_subscription" "s3" {
  count               = local.lattice_enabled
  resource_identifier = aws_vpclattice_service_network.this[0].arn
  destination_arn     = aws_s3_bucket.lattice_logs[0].arn
}

resource "aws_vpclattice_access_log_subscription" "cw" {
  count               = local.lattice_enabled
  resource_identifier = aws_vpclattice_service_network.this[0].arn
  destination_arn     = aws_cloudwatch_log_group.lattice_access[0].arn
}

# --- Broker Lattice service ------------------------------------------------

resource "aws_vpclattice_service" "broker" {
  count     = local.lattice_enabled
  name      = "${local.name_prefix}-broker"
  auth_type = "AWS_IAM"
  tags      = local.common_tags
}

resource "aws_vpclattice_service_network_service_association" "broker" {
  count                      = local.lattice_enabled
  service_identifier         = aws_vpclattice_service.broker[0].arn
  service_network_identifier = aws_vpclattice_service_network.this[0].arn
  tags                       = local.common_tags
}

# IP target group fed by the broker Fargate tasks (registered by ECS via the
# vpc_lattice_configurations block on aws_ecs_service.broker). The broker speaks
# plain HTTP on 8080; Lattice terminates the listener and forwards to this TG.
# Health check matches the broker's actual /health path (fixed in v2.0.4).
resource "aws_vpclattice_target_group" "broker" {
  count = local.lattice_enabled
  name  = "${local.name_prefix}-broker-lt"
  type  = "IP"

  config {
    port           = 8080
    protocol       = "HTTP"
    vpc_identifier = var.vpc_id

    health_check {
      enabled  = true
      path     = "/health"
      port     = 8080
      protocol = "HTTP"
    }
  }

  tags = local.common_tags
}

# Lattice terminates TLS at the service edge; the broker container only speaks
# plain HTTP on 8080, so the listener forwards over HTTP to the IP target group.
resource "aws_vpclattice_listener" "broker" {
  count              = local.lattice_enabled
  name               = "http"
  service_identifier = aws_vpclattice_service.broker[0].arn
  protocol           = "HTTP"
  port               = 80

  default_action {
    forward {
      target_groups {
        target_group_identifier = aws_vpclattice_target_group.broker[0].id
        weight                  = 100
      }
    }
  }

  tags = local.common_tags
}

# Auth policy on the broker service: ALLOW vpc-lattice-svcs:Invoke from any
# principal in THIS account. The transport is still authenticated (SigV4 / IAM)
# and the request is account-scoped via aws:PrincipalAccount.
#
# TIGHTENING PATH (Phase 3): replace the account-wide condition with explicit
# Principal ARNs for the calling/receiving task roles created by s2s-service.
# Those role ARNs do not exist yet at platform-apply time, so we cannot
# reference them here without a cross-module dependency cycle.
data "aws_iam_policy_document" "broker_lattice_auth" {
  count = local.lattice_enabled
  statement {
    sid    = "AllowInvokeFromAccount"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions   = ["vpc-lattice-svcs:Invoke"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_vpclattice_auth_policy" "broker" {
  count               = local.lattice_enabled
  resource_identifier = aws_vpclattice_service.broker[0].arn
  policy              = data.aws_iam_policy_document.broker_lattice_auth[0].json
}
