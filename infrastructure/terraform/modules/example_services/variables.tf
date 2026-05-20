variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "kms_cmk_arn" {
  description = "KMS CMK for SQS encryption (re-uses the secrets module CMK)"
  type        = string
}

variable "image_tag" {
  description = "Container image tag deployed to both Fargate services"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "workload_security_group_id" {
  type = string
}

variable "cognito_domain" {
  type = string
}

variable "lending_client_id" {
  type = string
}

variable "lending_client_secret_arn" {
  type = string
}

variable "redis_endpoint" {
  type = string
}

variable "avp_lending_policy_store_id" {
  type = string
}

variable "calling_repo_arn" {
  type = string
}

variable "receiving_repo_arn" {
  type = string
}
