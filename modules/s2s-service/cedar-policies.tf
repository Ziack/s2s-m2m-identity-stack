resource "aws_verifiedpermissions_policy" "cedar" {
  for_each = { for p in var.cedar_policies : p.name => p }

  policy_store_id = var.platform.policy_store_id

  definition {
    static {
      statement   = each.value.statement
      description = try(each.value.description, "Policy ${each.key} for ${var.service_name}")
    }
  }
}
