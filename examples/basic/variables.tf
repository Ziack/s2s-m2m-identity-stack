variable "region" {
  type    = string
  default = "us-east-1"
}

variable "account_id" {
  type = string
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "bounded_context" {
  type    = string
  default = "lending"
}

variable "image_tag" {
  type    = string
  default = "latest"
}
