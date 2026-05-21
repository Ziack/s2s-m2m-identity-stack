variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Subnet IDs for the broker Fargate tasks (typically the workload-private subnets)"
  type        = list(string)
}

variable "alb_arn" {
  description = "ARN of the example-services internal ALB (the broker re-uses it)"
  type        = string
}

variable "alb_listener_arn" {
  description = "ARN of the example-services HTTP listener on port 80"
  type        = string
}

variable "alb_security_group_id" {
  description = "Security group attached to the shared ALB — granted ingress on broker port 4000"
  type        = string
}

variable "alb_dns_name" {
  description = "DNS name of the shared ALB — used to derive the broker issuer URL"
  type        = string
}

variable "secrets_kms_key_arn" {
  description = "ARN of the secrets module's CMK — used to KMS-encrypt the broker's signing-key & actor-catalog secrets and to grant kms:Decrypt to the task role"
  type        = string
}

variable "redis_endpoint" {
  description = "Endpoint of the shared Valkey cluster used for jti replay storage"
  type        = string
}

variable "image_tag" {
  description = "ECR image tag for the token-broker container"
  type        = string
}

variable "ecr_repository_url" {
  description = "ECR repository URL for the token-broker image (without tag)"
  type        = string
}

variable "ecr_repository_arn" {
  description = "ECR repository ARN — used to scope the execution role's image-pull permissions"
  type        = string
}

variable "user_issuer_base_url" {
  description = "URL prefix of the calling-service local user IdP (e.g. http://<alb>/auth)"
  type        = string
}

variable "user_issuer_audience" {
  description = "Expected audience claim on inbound user (subject) tokens"
  type        = string
  default     = "calling-service"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "task_cpu" {
  type    = string
  default = "256"
}

variable "task_memory" {
  type    = string
  default = "512"
}

variable "container_port" {
  type    = number
  default = 4000
}

variable "ecs_cluster_id" {
  description = "ID of the existing ECS cluster the broker service should join"
  type        = string
}
