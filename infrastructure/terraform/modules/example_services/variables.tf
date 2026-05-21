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

variable "ledger_repo_arn" {
  type = string
}

variable "ledger_client_id" {
  type = string
}

variable "ledger_secret_arn" {
  type = string
}

variable "ledger_policy_store_id" {
  type = string
}

variable "receiving_outbound_client_id" {
  type = string
}

variable "receiving_outbound_secret_arn" {
  type = string
}

variable "ledger_audience" {
  type    = string
  default = "ledger"
}

# --- Token broker integration (Phase 6) --------------------------------------

variable "user_issuer_signing_secret_arn" {
  description = "Secrets Manager ARN of the calling-service user-issuer RSA signing key"
  type        = string
}

variable "broker_token_endpoint" {
  description = "Token broker /oauth2/token URL"
  type        = string
}

variable "broker_jwks_uri" {
  description = "Token broker JWKS URI"
  type        = string
}

variable "broker_issuer" {
  description = "Token broker issuer URL (matches BROKER_ISSUER_URL on the broker side)"
  type        = string
}

variable "broker_actor_secret_arn" {
  description = "Secrets Manager ARN holding the calling-service's broker-actor client_secret. Reuses the lending secret by default but can be a dedicated secret."
  type        = string
}
