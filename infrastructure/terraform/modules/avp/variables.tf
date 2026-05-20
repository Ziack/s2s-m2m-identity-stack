variable "bounded_contexts" {
  description = "List of bounded-context names. One policy store + identity source + seed policy per context."
  type        = list(string)
}

variable "user_pool_arn" {
  description = "Cognito user pool ARN used as the identity source for every policy store"
  type        = string
}
