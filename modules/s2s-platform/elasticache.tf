resource "aws_elasticache_serverless_cache" "this" {
  engine     = "valkey"
  name       = "${local.name_prefix}-cache"
  kms_key_id = aws_kms_key.secrets.arn

  cache_usage_limits {
    data_storage {
      maximum = 5
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = 5000
    }
  }

  major_engine_version = "7"
  security_group_ids   = [aws_security_group.workload.id]
  subnet_ids           = var.private_subnet_ids
  tags                 = local.common_tags
}
