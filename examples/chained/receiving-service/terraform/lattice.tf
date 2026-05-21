# Phase 4 (Job D): Lattice platform-field handoff via SSM.
#
# The platform publishes lattice_service_network_id + broker_lattice_dns to SSM
# ONLY when enable_lattice = true, so these data sources are guarded by the
# matching var.enable_lattice (empty for_each => no lookup when disabled).
data "aws_ssm_parameter" "platform_lattice" {
  for_each = var.enable_lattice ? toset([
    "lattice_service_network_id",
    "broker_lattice_dns",
  ]) : toset([])
  name = "/${var.environment}/s2s/platform/${each.value}"
}

# Publish this service's Lattice DNS so upstream callers (calling-service) can
# discover it cross-root. Only created when registered with Lattice.
resource "aws_ssm_parameter" "own_lattice_dns" {
  count = var.enable_lattice && module.receiving_service.lattice_service_dns != null ? 1 : 0
  name  = "/${var.environment}/s2s/services/receiving-service/lattice_dns"
  type  = "String"
  value = module.receiving_service.lattice_service_dns
}

# Consume the downstream ledger-service Lattice DNS (published by the ledger root,
# which MUST be applied first — see the apply-order note in the chained README).
data "aws_ssm_parameter" "ledger_lattice_dns" {
  count = var.enable_lattice ? 1 : 0
  name  = "/${var.environment}/s2s/services/ledger-service/lattice_dns"
}

locals {
  # Lattice env injected into the receiving-service task when Lattice is enabled.
  lattice_env = var.enable_lattice ? {
    USE_LATTICE        = "true"
    LEDGER_LATTICE_DNS = data.aws_ssm_parameter.ledger_lattice_dns[0].value
    BROKER_LATTICE_DNS = data.aws_ssm_parameter.platform_lattice["broker_lattice_dns"].value
  } : {}
}
