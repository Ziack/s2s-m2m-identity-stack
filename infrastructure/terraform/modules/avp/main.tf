locals {
  schema_json = jsonencode({
    M2M = {
      entityTypes = {
        ServicePrincipal = { shape = { type = "Record", attributes = {} } }
        ResourceGroup    = { shape = { type = "Record", attributes = { domain = { type = "String" } } } }
      }
      actions = {
        read  = { appliesTo = { principalTypes = ["ServicePrincipal"], resourceTypes = ["ResourceGroup"] } }
        write = { appliesTo = { principalTypes = ["ServicePrincipal"], resourceTypes = ["ResourceGroup"] } }
      }
    }
  })
}

resource "aws_verifiedpermissions_policy_store" "context" {
  for_each = toset(var.bounded_contexts)

  description = "${each.key} M2M authorization policies"

  validation_settings {
    mode = "STRICT"
  }
}

resource "aws_verifiedpermissions_schema" "context" {
  for_each = toset(var.bounded_contexts)

  policy_store_id = aws_verifiedpermissions_policy_store.context[each.key].policy_store_id

  definition {
    value = local.schema_json
  }
}

resource "aws_verifiedpermissions_identity_source" "context" {
  for_each = toset(var.bounded_contexts)

  policy_store_id       = aws_verifiedpermissions_policy_store.context[each.key].policy_store_id
  principal_entity_type = "ServicePrincipal"

  configuration {
    cognito_user_pool_configuration {
      user_pool_arn = var.user_pool_arn
    }
  }
}

resource "aws_verifiedpermissions_policy" "seed_read" {
  for_each = toset(var.bounded_contexts)

  policy_store_id = aws_verifiedpermissions_policy_store.context[each.key].policy_store_id

  depends_on = [aws_verifiedpermissions_schema.context]

  definition {
    static {
      description = "${each.key} seed read policy"
      statement   = <<-EOT
        permit (
          principal,
          action == M2M::Action::"read",
          resource
        ) when {
          context has dpop_confirmed && context.dpop_confirmed == true &&
          context has scopes && context.scopes.contains("${each.key}/read")
        };
      EOT
    }
  }
}
