resource "aws_ecr_repository" "this" {
  name                 = "${var.platform.environment}/${var.service_name}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.platform.kms_secrets_key_arn
  }
  tags = local.common_tags
}
