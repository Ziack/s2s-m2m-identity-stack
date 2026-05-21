variable "region" {
  type        = string
  description = "AWS region (e.g. us-east-1)."
  default     = "us-east-1"
}

variable "account_id" {
  type        = string
  description = "AWS account ID (12 digits)."
}

variable "environment" {
  type        = string
  description = "Name prefix (dev/staging/prod)."
  default     = "dev"
}

variable "vpc_id" {
  type        = string
  description = "VPC the platform deploys into. Not created by this root."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for ECS tasks + ElastiCache (at least 2 AZs)."
}

variable "alb_subnet_ids" {
  type        = list(string)
  description = "Subnets for the internal ALB (typically the same private subnets)."
}

variable "bounded_contexts" {
  type        = list(string)
  description = "Bounded-context taxonomy. Each entry creates a Cognito resource server + AVP policy store."
  default     = ["lending"]
}

variable "user_issuer_url" {
  type        = string
  description = "OIDC issuer URL for end-user tokens (the broker validates user tokens against this issuer)."
}

variable "user_issuer_audience" {
  type        = string
  description = "Expected `aud` claim on user tokens."
  default     = "platform"
}

variable "broker_image_uri" {
  type        = string
  description = "Container image for the token broker (e.g. ghcr.io/ziack/s2s-token-broker:v2.0.2)."
}

variable "broker_desired_count" {
  type        = number
  description = "ECS desired_count for the broker service."
  default     = 2
}

variable "broker_signing_key_rotation_days" {
  type        = number
  description = "How often the broker JWT signing key rotates."
  default     = 90
}

variable "broker_log_retention_days" {
  type        = number
  description = "CloudWatch log retention for /s2s/platform/broker and /s2s/platform/audit."
  default     = 30
}

variable "cognito_domain_prefix" {
  type        = string
  description = "Globally-unique Cognito hosted-UI domain prefix. Lowercase, 3-63 chars, [a-z0-9-]."
}

variable "enable_lattice" {
  type        = bool
  description = "Reserved for future VPC Lattice integration. Leave false."
  default     = false
}

variable "tags" {
  type        = map(string)
  description = "Extra tags applied to all platform resources."
  default     = {}
}
