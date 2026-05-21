provider "aws" {
  region = var.region

  default_tags {
    tags = merge(
      {
        managed-by  = "terraform"
        root        = "examples/_platform"
        environment = var.environment
      },
      var.tags,
    )
  }
}

module "platform" {
  source = "../../modules/s2s-platform"

  region                           = var.region
  account_id                       = var.account_id
  environment                      = var.environment
  vpc_id                           = var.vpc_id
  private_subnet_ids               = var.private_subnet_ids
  alb_subnet_ids                   = var.alb_subnet_ids
  bounded_contexts                 = var.bounded_contexts
  user_issuer_url                  = var.user_issuer_url
  user_issuer_audience             = var.user_issuer_audience
  broker_image_uri                 = var.broker_image_uri
  broker_desired_count             = var.broker_desired_count
  broker_signing_key_rotation_days = var.broker_signing_key_rotation_days
  broker_log_retention_days        = var.broker_log_retention_days
  cognito_domain_prefix            = var.cognito_domain_prefix
  enable_lattice                   = var.enable_lattice
  tags                             = var.tags
}
