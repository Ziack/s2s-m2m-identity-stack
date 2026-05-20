output "vpc_id" {
  value = aws_vpc.this.id
}

output "broker_alb_dns_name" {
  value = aws_lb.broker.dns_name
}

output "mapping_table_arn" {
  value = aws_dynamodb_table.mapping.arn
}
