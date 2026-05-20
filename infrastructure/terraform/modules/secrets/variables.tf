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

variable "receiving_outbound_client_id" {
  description = "Cognito client id of the receiving-service-outbound app client (templated into the receiving-outbound secret)"
  type        = string
}

variable "receiving_outbound_task_role_arns" {
  description = "ARNs of task roles permitted to read the receiving-outbound secret in addition to the standard task_role_arns. Pass receiving-service task role here when wiring example_services."
  type        = list(string)
  default     = []
}
