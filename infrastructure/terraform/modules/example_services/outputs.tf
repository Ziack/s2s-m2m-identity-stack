output "lending_queue_url" {
  value = aws_sqs_queue.lending.url
}

output "lending_queue_arn" {
  value = aws_sqs_queue.lending.arn
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "ledger_service_arn" {
  value = aws_ecs_service.ledger.id
}

output "ledger_target_group_arn" {
  value = aws_lb_target_group.ledger.arn
}

output "receiving_task_role_arn" {
  value = aws_iam_role.receiving_task.arn
}
