output "policy_store_ids" {
  description = "Map of bounded-context -> AVP policy store id"
  value       = { for ctx, s in aws_verifiedpermissions_policy_store.context : ctx => s.policy_store_id }
}

output "lending_policy_store_id" {
  value = aws_verifiedpermissions_policy_store.context["lending"].policy_store_id
}
