variable "region" {
  description = "AWS region to deploy the bootstrap VPC into."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. dev, sandbox). Used in Name tags and contributes to the platform's SSM prefix when reused downstream."
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block for the bootstrap VPC. The /20 subnets are carved from this. Defaults to 10.0.0.0/16, which yields 16 /20 slots — we use the first four (two public, two private)."
  type        = string
  default     = "10.0.0.0/16"
}

variable "tags" {
  description = "Tags applied to every resource. The module also merges in Name + Tier tags."
  type        = map(string)
  default     = {}
}
