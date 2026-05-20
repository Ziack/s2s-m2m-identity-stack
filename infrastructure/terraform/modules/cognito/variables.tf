variable "bounded_contexts" {
  description = "List of bounded-context names (resource servers + clients are created per context)"
  type        = list(string)
}

variable "domain_prefix" {
  description = "Cognito hosted-UI domain prefix"
  type        = string
}
