# Platform-injected sidecars.
#
# v2.0.0 ships with these lists EMPTY. The platform team adds entries here as
# operational/security agents are added (Wiz, Datadog APM, Fluent Bit, etc.).
#
# Each sidecar object schema:
#   {
#     name             = string
#     image            = string
#     essential        = bool
#     cpu              = number
#     memory           = number
#     environment      = list({ name = string, value = string })
#     secrets          = list({ name = string, valueFrom = string })
#     mount_points     = list({ source_volume = string, container_path = string, read_only = bool })
#     port_mappings    = list({ containerPort = number, protocol = string })
#     depends_on       = list({ container_name = string, condition = string })
#     mandatory        = bool
#     opt_out_services = list(string)  # services that may skip this sidecar
#     opt_in_services  = list(string)  # empty = universal; non-empty = ONLY these services
#   }
#
# Each IAM statement carries a `sidecar_name` discriminator so s2s-service can
# attach the right ones based on which sidecars a service actually runs.

locals {
  platform_sidecars               = []
  platform_sidecar_iam_statements = []
  platform_sidecar_volumes        = []
}
