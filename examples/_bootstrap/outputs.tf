output "vpc_id" {
  description = "ID of the bootstrap VPC. Paste into examples/_platform/fixtures/dev.tfvars.json as vpc_id."
  value       = aws_vpc.this.id
}

output "vpc_cidr_block" {
  description = "CIDR block of the bootstrap VPC."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "IDs of the two public subnets (default route → IGW)."
  value       = [for s in aws_subnet.public : s.id]
}

output "private_subnet_ids" {
  description = "IDs of the two private subnets (default route → NAT). Paste into examples/_platform/fixtures/dev.tfvars.json as private_subnet_ids."
  value       = [for s in aws_subnet.private : s.id]
}

output "alb_subnet_ids" {
  # Alias of public — the platform's ALB is "internal" but here we expose it via
  # public subnets for PoC convenience. Real prod typically uses an internal
  # ALB in private subnets fronted by a separate ingress.
  description = "Subnets for the platform's ALB. Defaults to the public subnets for PoC convenience; prod deployments likely want an internal ALB in private subnets."
  value       = [for s in aws_subnet.public : s.id]
}

output "next_steps" {
  description = "Paste these fields into examples/_platform/fixtures/dev.tfvars.json."
  value = jsonencode({
    vpc_id             = aws_vpc.this.id
    private_subnet_ids = [for s in aws_subnet.private : s.id]
    alb_subnet_ids     = [for s in aws_subnet.public : s.id]
  })
}
