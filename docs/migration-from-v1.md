# Migration from v1 to v2

The v1 → v2 migration is sweeping: the repo layout changes and the two new
modules `s2s-platform` + `s2s-service` together replace the v1
`infrastructure/terraform/` root.

You have two choices:

## Option A — Stay on v1 (recommended for stable production until v2.1)

Pin your module sources to the final v1 tag. No code change required. v1 is
in security-fix-only maintenance.

## Option B — In-place migrate to v2

Use Terraform `moved {}` blocks to rename state without destroy/recreate.
Apply the block below from a transitional root that consumes the v2 module —
the `moved` blocks tell Terraform "this resource you've seen before is now
at this new address". After one successful `apply` you can delete the
`moved` blocks.

> **Test this in dev/staging first.** Have a fresh state backup
> (`terraform state pull > pre-migration.tfstate`) before applying.

### Cognito

```hcl
moved {
  from = module.cognito.aws_cognito_user_pool.this
  to   = module.s2s_platform.aws_cognito_user_pool.this
}
moved {
  from = module.cognito.aws_cognito_user_pool_domain.this
  to   = module.s2s_platform.aws_cognito_user_pool_domain.this
}
moved {
  from = module.cognito.aws_cognito_resource_server.lending
  to   = module.s2s_platform.aws_cognito_resource_server.contexts["lending"]
}
```

### AVP

```hcl
moved {
  from = module.avp.aws_verifiedpermissions_policy_store.lending
  to   = module.s2s_platform.aws_verifiedpermissions_policy_store.contexts["lending"]
}
moved {
  from = module.avp.aws_verifiedpermissions_policy_store.payments
  to   = module.s2s_platform.aws_verifiedpermissions_policy_store.contexts["payments"]
}
moved {
  from = module.avp.aws_verifiedpermissions_schema.lending
  to   = module.s2s_platform.aws_verifiedpermissions_schema.contexts["lending"]
}
```

### Token broker

```hcl
moved {
  from = module.token_broker.aws_ecs_service.broker
  to   = module.s2s_platform.aws_ecs_service.broker
}
moved {
  from = module.token_broker.aws_ecs_task_definition.broker
  to   = module.s2s_platform.aws_ecs_task_definition.broker
}
moved {
  from = module.token_broker.aws_lb_target_group.broker
  to   = module.s2s_platform.aws_lb_target_group.broker
}
moved {
  from = module.token_broker.aws_iam_role.broker_task
  to   = module.s2s_platform.aws_iam_role.broker_task
}
moved {
  from = module.token_broker.aws_iam_role.broker_execution
  to   = module.s2s_platform.aws_iam_role.broker_execution
}
```

### Valkey / ElastiCache

```hcl
moved {
  from = module.elasticache.aws_elasticache_replication_group.this
  to   = module.s2s_platform.aws_elasticache_replication_group.valkey
}
moved {
  from = module.elasticache.aws_elasticache_subnet_group.this
  to   = module.s2s_platform.aws_elasticache_subnet_group.valkey
}
moved {
  from = module.elasticache.aws_security_group.this
  to   = module.s2s_platform.aws_security_group.valkey
}
```

### Secrets + KMS

The broker signing key + KMS CMK move to the platform module. Per-service
secrets move to `s2s-service`.

```hcl
moved {
  from = module.secrets.aws_kms_key.cmk
  to   = module.s2s_platform.aws_kms_key.cmk
}
moved {
  from = module.secrets.aws_kms_alias.cmk
  to   = module.s2s_platform.aws_kms_alias.cmk
}
moved {
  from = module.secrets.aws_secretsmanager_secret.broker_signing_key
  to   = module.s2s_platform.aws_secretsmanager_secret.broker_signing_key
}
moved {
  from = module.secrets.aws_secretsmanager_secret.lending_service_client
  to   = module.s2s_service_lending.aws_secretsmanager_secret.client_credentials
}
```

### ECR

```hcl
moved {
  from = module.ecr.aws_ecr_repository.token_broker
  to   = module.s2s_platform.aws_ecr_repository.broker
}
moved {
  from = module.ecr.aws_ecr_repository.calling_service
  to   = module.s2s_service_calling.aws_ecr_repository.this
}
moved {
  from = module.ecr.aws_ecr_repository.receiving_service
  to   = module.s2s_service_receiving.aws_ecr_repository.this
}
moved {
  from = module.ecr.aws_ecr_repository.ledger_service
  to   = module.s2s_service_ledger.aws_ecr_repository.this
}
```

### VPC Lattice (if `enable_lattice = true`)

```hcl
moved {
  from = module.lattice.aws_vpclattice_service_network.this
  to   = module.s2s_platform.aws_vpclattice_service_network.this
}
moved {
  from = module.lattice.aws_vpclattice_service.broker
  to   = module.s2s_platform.aws_vpclattice_service.broker
}
moved {
  from = module.lattice.aws_vpclattice_service_network_service_association.broker
  to   = module.s2s_platform.aws_vpclattice_service_network_service_association.broker
}
```

### Hybrid broker (if `enable_hybrid_broker = true`)

```hcl
moved {
  from = module.hybrid_broker.aws_ecs_service.hybrid
  to   = module.s2s_platform.aws_ecs_service.hybrid_broker
}
moved {
  from = module.hybrid_broker.aws_ecs_task_definition.hybrid
  to   = module.s2s_platform.aws_ecs_task_definition.hybrid_broker
}
```

### Example services → s2s-service

```hcl
moved {
  from = module.example_services.aws_ecs_service.calling
  to   = module.s2s_service_calling.aws_ecs_service.this
}
moved {
  from = module.example_services.aws_ecs_service.receiving
  to   = module.s2s_service_receiving.aws_ecs_service.this
}
moved {
  from = module.example_services.aws_ecs_service.ledger
  to   = module.s2s_service_ledger.aws_ecs_service.this
}
moved {
  from = module.example_services.aws_lb.this
  to   = module.s2s_platform.aws_lb.shared
}
```

## After applying

```bash
terraform plan
# Expect: "0 to add, 0 to change, 0 to destroy."
# If you see any destroy/create pairs, STOP — a moved block is missing or
# misnamed. Roll back: terraform state push pre-migration.tfstate.
```

Once `plan` is clean, delete the `moved` blocks in a follow-up commit.

## Cedar policy migration

The v2 schema changes `context.client_id` to `context.actor_chain[0].client_id`.
The `@s2s/cedar-tooling` CLI ships a one-shot rewriter:

```bash
npx @s2s/cedar-tooling migrate-v1 policies/
```

This rewrites every `context.client_id` reference and emits the v2 form in
place. Review the diff and re-run `npx @s2s/cedar-tooling validate policies/`.
