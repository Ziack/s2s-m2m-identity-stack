terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region                      = "us-east-1"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  access_key                  = "mock"
  secret_key                  = "mock"
}

locals {
  fake_platform = {
    account_id                 = "123456789012"
    region                     = "us-east-1"
    environment                = "dev"
    user_pool_id               = "us-east-1_FAKE"
    cognito_domain             = "fake.auth.us-east-1.amazoncognito.com"
    broker_url                 = "https://fake-alb.internal"
    broker_jwks_uri            = "https://fake-alb.internal/.well-known/jwks.json"
    broker_token_endpoint      = "https://fake-alb.internal/oauth2/token"
    broker_issuer              = "https://fake-alb.internal"
    kms_secrets_key_arn        = "arn:aws:kms:us-east-1:123456789012:key/abcd-fake"
    redis_endpoint             = "fake.cache.amazonaws.com"
    redis_port                 = 6379
    alb_dns_name               = "fake-alb.internal"
    alb_listener_arn           = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/fake/abc/def"
    alb_security_group_id      = "sg-alb-fake"
    workload_security_group_id = "sg-workload-fake"
    ecs_cluster_arn            = "arn:aws:ecs:us-east-1:123456789012:cluster/fake"
    ecs_cluster_name           = "fake-cluster"
    vpc_id                     = "vpc-fake"
    private_subnet_ids         = ["subnet-fake-a", "subnet-fake-b"]
    policy_store_id            = "ps-fake-lending"
    resource_server_identifier = "lending"
    sidecars                   = []
    sidecar_iam_statements     = []
    sidecar_volumes            = []
  }
}

module "service" {
  source   = "../"
  platform = local.fake_platform

  service_name               = var.service_name
  bounded_context            = var.bounded_context
  scopes                     = var.scopes
  image_uri                  = var.image_uri
  alb_path_pattern           = var.alb_path_pattern
  alb_listener_rule_priority = var.alb_listener_rule_priority
  outbound_audiences         = var.outbound_audiences
}

variable "service_name" { type = string }
variable "bounded_context" { type = string }
variable "scopes" { type = list(string) }
variable "image_uri" { type = string }
variable "alb_path_pattern" { type = string }
variable "alb_listener_rule_priority" { type = number }
variable "outbound_audiences" { type = list(string) }
