variable "platform" {
  description = "Composite of platform outputs (from module.platform.platform or assembled from SSM)."
  type = object({
    account_id                 = string
    region                     = string
    environment                = string
    user_pool_id               = string
    cognito_domain             = string
    broker_url                 = string
    broker_jwks_uri            = string
    broker_token_endpoint      = string
    broker_issuer              = string
    kms_secrets_key_arn        = string
    redis_endpoint             = string
    redis_port                 = optional(number, 6379)
    alb_dns_name               = string
    alb_listener_arn           = string
    alb_security_group_id      = string
    workload_security_group_id = string
    ecs_cluster_arn            = string
    ecs_cluster_name           = string
    vpc_id                     = string
    private_subnet_ids         = list(string)
    policy_store_id            = string
    resource_server_identifier = string
    sidecars = optional(list(object({
      name             = string
      image            = string
      essential        = optional(bool, false)
      cpu              = optional(number, 0)
      memory           = optional(number, 0)
      environment      = optional(list(object({ name = string, value = string })), [])
      secrets          = optional(list(object({ name = string, valueFrom = string })), [])
      mount_points     = optional(list(object({ source_volume = string, container_path = string, read_only = bool })), [])
      port_mappings    = optional(list(object({ containerPort = number, protocol = string })), [])
      depends_on       = optional(list(object({ container_name = string, condition = string })), [])
      mandatory        = optional(bool, true)
      opt_out_services = optional(list(string), [])
      opt_in_services  = optional(list(string), [])
    })), [])
    sidecar_iam_statements = optional(list(object({
      sidecar_name = string
      effect       = string
      actions      = list(string)
      resources    = list(string)
    })), [])
    sidecar_volumes = optional(list(object({
      name = string
    })), [])
  })
}

variable "service_name" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*$", var.service_name))
    error_message = "service_name must be lowercase, DNS-safe."
  }
}

variable "bounded_context" {
  type = string
}

variable "scopes" {
  type    = list(string)
  default = []
  validation {
    condition     = alltrue([for s in var.scopes : can(regex("^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$", s))])
    error_message = "Each scope must match <context>/<action> with lowercase alphanumeric segments."
  }
}

variable "image_uri" {
  type = string
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "health_check_path" {
  type    = string
  default = "/health"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alb_path_pattern" {
  type = string
}

variable "alb_listener_rule_priority" {
  type = number
}

variable "cedar_policies" {
  type = list(object({
    name        = string
    statement   = string
    description = optional(string)
  }))
  default = []
}

variable "outbound_audiences" {
  type    = list(string)
  default = []
}

variable "env" {
  description = "Extra env vars merged on top of platform-managed standard env. Collisions REJECTED at plan time."
  type        = map(string)
  default     = {}
  validation {
    condition = length(setintersection(keys(var.env), [
      "COGNITO_DOMAIN", "USER_POOL_ID", "COGNITO_CLIENT_ID", "COGNITO_CLIENT_SECRET_ARN",
      "BROKER_URL", "BROKER_JWKS_URI", "BROKER_ISSUER", "BROKER_AUDIENCE", "BROKER_TOKEN_ENDPOINT",
      "REDIS_ENDPOINT", "REDIS_PORT",
      "AVP_POLICY_STORE_ID", "AVP_RESOURCE_SERVER",
      "AWS_REGION", "OUTBOUND_AUDIENCES",
    ])) == 0
    error_message = "var.env collides with a platform-managed env var name. Forbidden keys: COGNITO_DOMAIN, USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET_ARN, BROKER_URL, BROKER_JWKS_URI, BROKER_ISSUER, BROKER_AUDIENCE, BROKER_TOKEN_ENDPOINT, REDIS_ENDPOINT, REDIS_PORT, AVP_POLICY_STORE_ID, AVP_RESOURCE_SERVER, AWS_REGION, OUTBOUND_AUDIENCES."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
