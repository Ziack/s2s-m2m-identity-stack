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

# Publish this service's Lattice DNS so upstream callers (receiving-service) can
# discover it cross-root. Only created when registered with Lattice. NOTE: this
# lives in the EXAMPLE root, not the s2s-service module (which is frozen).
resource "aws_ssm_parameter" "own_lattice_dns" {
  count = var.enable_lattice && module.ledger_service.lattice_service_dns != null ? 1 : 0
  name  = "/${var.environment}/s2s/services/ledger-service/lattice_dns"
  type  = "String"
  value = module.ledger_service.lattice_service_dns
}
