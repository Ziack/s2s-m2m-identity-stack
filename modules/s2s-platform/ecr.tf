resource "aws_ecr_repository" "broker" {
  name                 = "${local.name_prefix}/token-broker"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.secrets.arn
  }
  tags = local.common_tags
}
