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

# Consume the downstream receiving-service Lattice DNS (published by the receiving
# root, which MUST be applied first — see the apply-order note in the chained
# README). calling-service is the chain entrypoint; nothing calls it over Lattice,
# so it does not publish its own lattice_dns.
data "aws_ssm_parameter" "receiving_lattice_dns" {
  count = var.enable_lattice ? 1 : 0
  name  = "/${var.environment}/s2s/services/receiving-service/lattice_dns"
}

locals {
  # Lattice env injected into the calling-service task when Lattice is enabled.
  # Only the data-plane callee (receiving) DNS is threaded: the control-plane
  # broker token-exchange stays on the broker ALB (client_secret_basic) and uses
  # BROKER_TOKEN_ENDPOINT in BOTH modes, so BROKER_LATTICE_DNS is intentionally
  # NOT injected. The platform broker_lattice_dns is still consumed by the
  # s2s-service module's `platform` object (see main.tf) for service registration.
  lattice_env = var.enable_lattice ? {
    USE_LATTICE           = "true"
    RECEIVING_LATTICE_DNS = data.aws_ssm_parameter.receiving_lattice_dns[0].value
  } : {}
}
