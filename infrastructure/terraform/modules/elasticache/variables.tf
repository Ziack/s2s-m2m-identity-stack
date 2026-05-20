variable "availability_zones" {
  description = "Explicit list of AZs to span. If empty, looked up dynamically via aws_availability_zones data source."
  type        = list(string)
  default     = []
}

variable "vpc_cidr" {
  description = "CIDR for the M2M VPC"
  type        = string
  default     = "10.20.0.0/16"
}
