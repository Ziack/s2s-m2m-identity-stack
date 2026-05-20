variable "region" {
  description = "AWS region (used for log driver awslogs-region option)"
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "Explicit list of AZs to span. If empty, looked up dynamically via aws_availability_zones data source."
  type        = list(string)
  default     = []
}

variable "vpc_cidr" {
  description = "CIDR for the network hub VPC"
  type        = string
  default     = "10.30.0.0/16"
}

variable "onprem_cidr" {
  description = "On-premises CIDR routed over the site-to-site VPN"
  type        = string
}

variable "customer_vpn_gateway_ip" {
  description = "Public IP of the customer-side VPN device"
  type        = string
}

variable "customer_bgp_asn" {
  description = "BGP ASN advertised by the customer gateway"
  type        = number
}

variable "broker_image" {
  description = "Container image used by the broker Fargate service"
  type        = string
}

variable "broker_min_capacity" {
  description = "ECS service min task count"
  type        = number
  default     = 2
}

variable "broker_max_capacity" {
  description = "ECS service max task count"
  type        = number
  default     = 10
}
