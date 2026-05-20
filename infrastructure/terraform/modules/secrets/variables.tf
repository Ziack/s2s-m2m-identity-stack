variable "bounded_contexts" {
  description = "List of bounded-context names — one secret + rotation per context"
  type        = list(string)
}

variable "user_pool_id" {
  description = "Cognito user pool id (templated into each secret)"
  type        = string
}

variable "user_pool_arn" {
  description = "Cognito user pool ARN — rotation Lambda needs cognito-idp permissions against it"
  type        = string
}

variable "client_ids" {
  description = "Map of bounded-context -> Cognito user pool client id"
  type        = map(string)
}

variable "task_role_arns" {
  description = "ARNs of ECS task / EKS pod roles allowed to read the secrets (resource policy)"
  type        = list(string)
}
