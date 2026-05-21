resource "aws_verifiedpermissions_policy_store" "contexts" {
  for_each    = toset(var.bounded_contexts)
  description = "${each.value} policy store"

  validation_settings {
    mode = "STRICT"
  }
}

resource "aws_verifiedpermissions_schema" "contexts" {
  for_each        = toset(var.bounded_contexts)
  policy_store_id = aws_verifiedpermissions_policy_store.contexts[each.value].id

  definition {
    value = jsonencode({
      (each.value) = {
        actions = {
          "read"  = { appliesTo = { principalTypes = ["Service"], resourceTypes = ["Resource"] } }
          "write" = { appliesTo = { principalTypes = ["Service"], resourceTypes = ["Resource"] } }
        }
        entityTypes = {
          Service = {
            shape = {
              type = "Record"
              attributes = {
                client_id = { type = "String" }
              }
            }
          }
          Resource = {
            shape = {
              type       = "Record"
              attributes = {}
            }
          }
        }
        commonTypes = {
          AuthContext = {
            type = "Record"
            attributes = {
              user        = { type = "String", required = false }
              actor_chain = { type = "Set", element = { type = "String" }, required = false }
            }
          }
        }
      }
    })
  }
}

resource "aws_verifiedpermissions_identity_source" "contexts" {
  for_each        = toset(var.bounded_contexts)
  policy_store_id = aws_verifiedpermissions_policy_store.contexts[each.value].id

  configuration {
    cognito_user_pool_configuration {
      user_pool_arn = aws_cognito_user_pool.this.arn
    }
  }
  principal_entity_type = "Service"
}
