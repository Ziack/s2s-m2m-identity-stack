variable "region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "account_id" {
  description = "AWS account id. Optional — if empty the provider's caller identity is looked up at apply time. Set to a placeholder (e.g. 000000000000) for offline `terraform plan` runs."
  type        = string
  default     = ""
}

variable "environment" {
  description = "Deployment environment tag (e.g. dev, stage, prod)"
  type        = string
  default     = "dev"
}

variable "cognito_domain_prefix" {
  description = "Cognito hosted-UI domain prefix"
  type        = string
  default     = "s2s-m2m"
}

variable "task_role_arns" {
  description = "ARNs of ECS task / EKS pod roles permitted to read M2M secrets. A placeholder is included by default so the secret resource policy can synth before example_services is wired."
  type        = list(string)
  default     = ["arn:aws:iam::000000000000:role/s2s-m2m-task-role-placeholder"]
}

variable "onprem_cidr" {
  description = "On-premises CIDR routed over the site-to-site VPN"
  type        = string
  default     = "10.50.0.0/16"
}

variable "customer_vpn_gateway_ip" {
  description = "Public IP of the customer-side VPN device"
  type        = string
  default     = "203.0.113.10"
}

variable "customer_bgp_asn" {
  description = "BGP ASN advertised by the customer gateway"
  type        = number
  default     = 65000
}

variable "image_tag" {
  description = "Container image tag deployed to ECS Fargate"
  type        = string
  default     = "initial"
}

variable "availability_zones" {
  description = "Explicit AZs to use for VPCs. Leave empty to look up at apply time via aws_availability_zones."
  type        = list(string)
  default     = []
}

variable "broker_image" {
  description = "Container image for the hybrid broker (PoC placeholder)"
  type        = string
  default     = "public.ecr.aws/nginx/nginx:1.27-alpine"
}
