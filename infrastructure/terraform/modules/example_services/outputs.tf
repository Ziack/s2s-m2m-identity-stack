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
