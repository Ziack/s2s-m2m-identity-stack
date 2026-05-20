output "service_network_arn" {
  value = aws_vpclattice_service_network.this.arn
}

output "service_arns" {
  description = "Map of bounded-context -> Lattice service ARN"
  value       = { for ctx, s in aws_vpclattice_service.context : ctx => s.arn }
}
