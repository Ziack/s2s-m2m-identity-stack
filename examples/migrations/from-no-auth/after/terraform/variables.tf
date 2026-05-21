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
  default = "platform-internal"
}

variable "account_id" {
  type    = string
  default = "123456789012"
}
