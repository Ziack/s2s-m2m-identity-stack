provider "aws" {
  region = var.region

  # Allow `terraform plan -var-file=fixtures/example.tfvars` to run offline
  # against placeholder credentials for validation/CI purposes. These flags are
  # no-ops when real credentials are present.
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true

  default_tags {
    tags = {
      Project     = "s2s-m2m-identity"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {
  count = var.account_id == "" ? 1 : 0
}

locals {
  bounded_contexts = ["lending", "deposits", "payments", "fraud", "notifications", "accounts", "ledger"]
  account_id       = var.account_id != "" ? var.account_id : data.aws_caller_identity.current[0].account_id
  region           = var.region
}

module "cognito" {
  source = "./modules/cognito"

  bounded_contexts = local.bounded_contexts
  domain_prefix    = var.cognito_domain_prefix
}

module "secrets" {
  source = "./modules/secrets"

  bounded_contexts             = local.bounded_contexts
  user_pool_id                 = module.cognito.user_pool_id
  user_pool_arn                = module.cognito.user_pool_arn
  client_ids                   = module.cognito.client_ids
  task_role_arns               = var.task_role_arns
  receiving_outbound_client_id = module.cognito.receiving_outbound_client_id
}

module "elasticache" {
  source = "./modules/elasticache"

  availability_zones = var.availability_zones
}

module "avp" {
  source = "./modules/avp"

  bounded_contexts = local.bounded_contexts
  user_pool_arn    = module.cognito.user_pool_arn
}

module "lattice" {
  source = "./modules/lattice"

  bounded_contexts = local.bounded_contexts
  account_id       = local.account_id
  region           = local.region
}

module "hybrid_broker" {
  source = "./modules/hybrid_broker"

  region                  = local.region
  availability_zones      = var.availability_zones
  onprem_cidr             = var.onprem_cidr
  customer_vpn_gateway_ip = var.customer_vpn_gateway_ip
  customer_bgp_asn        = var.customer_bgp_asn
  broker_image            = var.broker_image
}

module "ecr" {
  source = "./modules/ecr"

  kms_key_arn = module.secrets.kms_key_arn
}

module "example_services" {
  source = "./modules/example_services"

  region                         = local.region
  account_id                     = local.account_id
  kms_cmk_arn                    = module.secrets.kms_key_arn
  image_tag                      = var.image_tag
  vpc_id                         = module.elasticache.vpc_id
  private_subnet_ids             = module.elasticache.private_subnet_ids
  workload_security_group_id     = module.elasticache.workload_security_group_id
  cognito_domain                 = "${var.cognito_domain_prefix}.auth.${local.region}.amazoncognito.com"
  lending_client_id              = module.cognito.lending_client_id
  lending_client_secret_arn      = module.secrets.lending_secret_arn
  redis_endpoint                 = module.elasticache.valkey_endpoint
  avp_lending_policy_store_id    = module.avp.lending_policy_store_id
  calling_repo_arn               = module.ecr.calling_repo_arn
  receiving_repo_arn             = module.ecr.receiving_repo_arn
  ledger_repo_arn                = module.ecr.ledger_repo_arn
  ledger_client_id               = module.cognito.ledger_client_id
  ledger_secret_arn              = module.secrets.ledger_secret_arn
  ledger_policy_store_id         = module.avp.ledger_policy_store_id
  receiving_outbound_client_id   = module.cognito.receiving_outbound_client_id
  receiving_outbound_secret_arn  = module.secrets.receiving_outbound_secret_arn
  user_issuer_signing_secret_arn = module.secrets.user_issuer_signing_secret_arn
  broker_token_endpoint          = module.token_broker.broker_token_endpoint
  broker_jwks_uri                = module.token_broker.broker_jwks_uri
  broker_issuer                  = module.token_broker.broker_issuer
  # Single-actor mode: calling-service authenticates to the broker with its
  # existing lending client_secret. Swap to a dedicated secret once a
  # broker-actor rotation lambda is in place.
  broker_actor_secret_arn = module.secrets.lending_secret_arn
}

module "token_broker" {
  source = "./modules/token_broker"

  region                = local.region
  account_id            = local.account_id
  vpc_id                = module.elasticache.vpc_id
  subnet_ids            = module.elasticache.private_subnet_ids
  alb_arn               = module.example_services.alb_arn
  alb_listener_arn      = module.example_services.alb_listener_arn
  alb_security_group_id = module.example_services.alb_security_group_id
  alb_dns_name          = module.example_services.alb_dns_name
  secrets_kms_key_arn   = module.secrets.kms_key_arn
  redis_endpoint        = module.elasticache.valkey_endpoint
  image_tag             = var.image_tag
  ecr_repository_url    = module.ecr.broker_repo_uri
  ecr_repository_arn    = module.ecr.broker_repo_arn
  ecs_cluster_id        = module.example_services.cluster_id
  # The calling-service hosts the user IdP at /auth on the same ALB.
  user_issuer_base_url = "http://${module.example_services.alb_dns_name}/auth"
  user_issuer_audience = "calling-service"
}
