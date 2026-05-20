output "vpc_id" {
  value = aws_vpc.this.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "isolated_subnet_ids" {
  value = aws_subnet.isolated[*].id
}

output "workload_security_group_id" {
  value = aws_security_group.workload.id
}

output "cache_security_group_id" {
  value = aws_security_group.cache.id
}

output "valkey_endpoint" {
  value = aws_elasticache_serverless_cache.valkey.endpoint[0].address
}

output "valkey_port" {
  value = tostring(aws_elasticache_serverless_cache.valkey.endpoint[0].port)
}
