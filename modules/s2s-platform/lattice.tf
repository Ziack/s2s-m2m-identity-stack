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

