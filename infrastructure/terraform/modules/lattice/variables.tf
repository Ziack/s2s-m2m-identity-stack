variable "bounded_contexts" {
  description = "List of bounded-context names. One Lattice service + listener per context."
  type        = list(string)
}

variable "account_id" {
  description = "AWS account id (used to compose the S3 logs bucket name)"
  type        = string
}

variable "region" {
  description = "AWS region (used to compose the S3 logs bucket name)"
  type        = string
}
