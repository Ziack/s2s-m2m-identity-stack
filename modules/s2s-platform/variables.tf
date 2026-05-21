variable "region" {
  type        = string
  description = "AWS region (e.g. us-east-1)."
}

variable "account_id" {
  type        = string
  description = "AWS account ID."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "environment" {
  type        = string
  description = "Name prefix (dev/staging/prod)."
}

variable "vpc_id" {
  type        = string
  description = "VPC the platform deploys into. Not created by this module."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for ECS tasks + ElastiCache."
}

variable "alb_subnet_ids" {
  type        = list(string)
  description = "Subnets for the internal ALB."
}

variable "internal_alb" {
  type    = bool
  default = true
}

variable "bounded_contexts" {
  type        = list(string)
  default     = []
  description = "Bounded-context taxonomy. Each entry creates a Cognito resource server + AVP policy store."
}

variable "user_issuer_url" {
  type = string
}

variable "user_issuer_audience" {
  type    = string
  default = "platform"
}

variable "broker_image_uri" {
  type        = string
  description = "Container image for the token broker (e.g. ghcr.io/ziack/s2s-token-broker:v2.0.0)."
}

variable "broker_desired_count" {
  type    = number
  default = 2
}

variable "broker_signing_key_rotation_days" {
  type    = number
  default = 90
}

variable "broker_log_retention_days" {
  type    = number
  default = 30
}

variable "cognito_domain_prefix" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]{3,63}$", var.cognito_domain_prefix))
    error_message = "cognito_domain_prefix must be lowercase alphanumeric/hyphens, 3-63 chars."
  }
}

variable "enable_lattice" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
