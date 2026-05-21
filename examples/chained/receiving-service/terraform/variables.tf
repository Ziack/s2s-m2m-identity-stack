variable "region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "bounded_context" {
  type    = string
  default = "lending"
}

variable "account_id" {
  type        = string
  description = "AWS account id used to construct the ECR image URI."
  default     = "123456789012"
}

variable "enable_lattice" {
  type        = bool
  default     = false
  description = <<-EOT
    Set true when the platform was deployed with enable_lattice = true. Gates the
    Phase-2 Lattice platform fields (read from SSM) and the per-service
    lattice_service_dns publish/consume handoff. Must match the platform's
    enable_lattice setting, otherwise the Lattice SSM params won't exist.
  EOT
}
