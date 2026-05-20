output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "domain" {
  value = aws_cognito_user_pool_domain.this.domain
}

output "client_ids" {
  description = "Map of bounded-context name -> Cognito user pool client id"
  value       = { for ctx, c in aws_cognito_user_pool_client.context : ctx => c.id }
}

output "lending_client_id" {
  value = aws_cognito_user_pool_client.context["lending"].id
}

output "batch_client_id" {
  value = aws_cognito_user_pool_client.batch_processor.id
}
