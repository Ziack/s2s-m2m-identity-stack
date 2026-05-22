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
    # --- VPC Lattice plane (Phase 2 platform fields) ---
    # Optional with safe defaults so existing consumers that assemble the
    # platform object without these fields keep validating AND keep Lattice
    # OFF (zero behavior change). The platform composite output always sets
    # all three; SSM-assembled consumers may add them later (Phase 4).
    enable_lattice             = optional(bool, false)
    lattice_service_network_id = optional(string)
    broker_lattice_dns         = optional(string)
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
  description = "Single ALB listener-rule path match. Mutually exclusive with alb_path_patterns; exactly one of the two must be set."
  type        = string
  default     = null
}

variable "alb_path_patterns" {
  description = "List of ALB listener-rule path matches (up to 5, OR'd in ONE listener rule). Mutually exclusive with alb_path_pattern; exactly one of the two must be set."
  type        = list(string)
  default     = null
  validation {
    condition     = (var.alb_path_pattern == null) != (var.alb_path_patterns == null)
    error_message = "Set exactly one of alb_path_pattern (string) or alb_path_patterns (list(string)), not both and not neither."
  }
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

variable "register_with_lattice" {
  description = <<-EOT
    Register THIS service with VPC Lattice (own Lattice service + IP target group +
    listener + auth policy + ECS-managed target registration). Only takes effect
    when var.platform.enable_lattice is also true. Defaults true so a Lattice-enabled
    platform registers every service by default; set false to opt a single service out
    while leaving it reachable over the ALB only.
  EOT
  type        = bool
  default     = true
}

variable "lattice_allowed_caller_arns" {
  description = <<-EOT
    Optional list of principal (IAM role) ARNs allowed to invoke this service's
    Lattice service. When empty (default) the auth policy allows any principal in
    THIS account (network-layer defense-in-depth; DPoP + Cedar provide real authZ).
    When non-empty, the auth policy is tightened to ONLY these principal ARNs.
  EOT
  type        = list(string)
  default     = []
}

variable "calls_broker" {
  description = <<-EOT
    Whether this service makes outbound SigV4-signed calls to the broker (token
    exchange). Defaults true — every service exchanges actor credentials at the
    broker. Together with outbound_audiences this gates the task-role
    vpc-lattice-svcs:Invoke statement.
  EOT
  type        = bool
  default     = true
}

variable "env" {
  description = "Extra env vars merged on top of platform-managed standard env. Collisions REJECTED at plan time."
  type        = map(string)
  default     = {}
  validation {
    condition = length(setintersection(keys(var.env), [
      "COGNITO_DOMAIN", "USER_POOL_ID", "COGNITO_CLIENT_ID", "COGNITO_CLIENT_SECRET_ARN", "M2M_CLIENT_SECRET_ARN",
      "BROKER_URL", "BROKER_JWKS_URI", "BROKER_ISSUER", "BROKER_AUDIENCE", "BROKER_TOKEN_ENDPOINT",
      "REDIS_ENDPOINT", "REDIS_PORT",
      "AVP_POLICY_STORE_ID", "AVP_RESOURCE_SERVER",
      "AWS_REGION", "OUTBOUND_AUDIENCES",
    ])) == 0
    error_message = "var.env collides with a platform-managed env var name. Forbidden keys: COGNITO_DOMAIN, USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET_ARN, M2M_CLIENT_SECRET_ARN, BROKER_URL, BROKER_JWKS_URI, BROKER_ISSUER, BROKER_AUDIENCE, BROKER_TOKEN_ENDPOINT, REDIS_ENDPOINT, REDIS_PORT, AVP_POLICY_STORE_ID, AVP_RESOURCE_SERVER, AWS_REGION, OUTBOUND_AUDIENCES."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
