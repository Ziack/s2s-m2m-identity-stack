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

module "platform" {
  source = "../"

  region                = var.region
  account_id            = var.account_id
  environment           = var.environment
  vpc_id                = var.vpc_id
  private_subnet_ids    = var.private_subnet_ids
  alb_subnet_ids        = var.alb_subnet_ids
  bounded_contexts      = var.bounded_contexts
  user_issuer_url       = var.user_issuer_url
  broker_image_uri      = var.broker_image_uri
  cognito_domain_prefix = var.cognito_domain_prefix
}

variable "region" { type = string }
variable "account_id" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "alb_subnet_ids" { type = list(string) }
variable "bounded_contexts" { type = list(string) }
variable "user_issuer_url" { type = string }
variable "broker_image_uri" { type = string }
variable "cognito_domain_prefix" { type = string }
