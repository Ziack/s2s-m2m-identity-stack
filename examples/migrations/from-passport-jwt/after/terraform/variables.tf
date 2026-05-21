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
  default = "orders"
}

variable "account_id" {
  type        = string
  description = "AWS account id used to construct the ECR image URI."
  default     = "123456789012"
}
