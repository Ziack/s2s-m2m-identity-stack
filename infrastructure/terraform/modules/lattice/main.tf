resource "aws_vpclattice_service_network" "this" {
  name      = "s2s-m2m-network"
  auth_type = "AWS_IAM"
}

resource "aws_s3_bucket" "lattice_logs" {
  bucket        = "s2s-m2m-lattice-logs-${var.account_id}-${var.region}"
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lattice_logs" {
  bucket = aws_s3_bucket.lattice_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "lattice_logs" {
  bucket                  = aws_s3_bucket.lattice_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudwatch_log_group" "lattice_access" {
  name              = "/aws/vpclattice/s2s-m2m-network"
  retention_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_vpclattice_access_log_subscription" "s3" {
  resource_identifier = aws_vpclattice_service_network.this.arn
  destination_arn     = aws_s3_bucket.lattice_logs.arn
}

resource "aws_vpclattice_access_log_subscription" "cw" {
  resource_identifier = aws_vpclattice_service_network.this.arn
  destination_arn     = aws_cloudwatch_log_group.lattice_access.arn
}

resource "aws_vpclattice_service" "context" {
  for_each = toset(var.bounded_contexts)

  name      = "s2s-${each.key}"
  auth_type = "AWS_IAM"
}

resource "aws_vpclattice_service_network_service_association" "context" {
  for_each = toset(var.bounded_contexts)

  service_identifier         = aws_vpclattice_service.context[each.key].arn
  service_network_identifier = aws_vpclattice_service_network.this.arn
}

resource "aws_vpclattice_listener" "context" {
  for_each = toset(var.bounded_contexts)

  name               = "https"
  service_identifier = aws_vpclattice_service.context[each.key].arn
  protocol           = "HTTPS"
  port               = 443

  default_action {
    fixed_response {
      status_code = 404
    }
  }
}
