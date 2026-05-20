output "calling_repo_uri" {
  value = aws_ecr_repository.this["s2s-calling-service"].repository_url
}

output "receiving_repo_uri" {
  value = aws_ecr_repository.this["s2s-receiving-service"].repository_url
}

output "calling_repo_arn" {
  value = aws_ecr_repository.this["s2s-calling-service"].arn
}

output "receiving_repo_arn" {
  value = aws_ecr_repository.this["s2s-receiving-service"].arn
}
