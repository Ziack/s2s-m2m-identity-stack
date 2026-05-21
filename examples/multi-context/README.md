# Multi-context Example — two services, one bounded context

Demonstrates the "multiple services per bounded context" pattern: `loan-origination` and `loan-servicing` are independent Fargate services with their own Cognito clients, ECR repos, secrets, and IAM roles — but both declare `bounded_context = "lending"` and therefore share the SAME AVP policy store and the SAME Cognito resource server.

## What's shared vs. what's per-service

|                       | Shared (platform-managed)              | Per-service (created by `s2s-service`)        |
| --- | --- | --- |
| Bounded context name  | `lending`                              | declared by each service via `bounded_context` |
| AVP policy store      | one — `lending` store                  | each service contributes its own policies     |
| Cognito resource server / scope namespace | `lending/*`        | each service declares the scopes it consumes  |
| Cognito app client    | —                                      | one per service                               |
| Client secret         | —                                      | one per service                               |
| ECR repo / image      | —                                      | one per service                               |
| ALB listener rule     | —                                      | one per service (distinct path patterns)      |
| IAM task role         | —                                      | one per service                               |

## Cedar policy union

Both services pass `cedar_policies` to the `s2s-service` module. The module uploads each into the SAME `lending` policy store with a name prefixed by the calling service. At evaluation time, the AVP store applies the UNION of all policies, regardless of which service uploaded them.

This is why `forbid` statements need care: a forbid in `loan-origination/policies/originate.cedar` will affect requests authorized by `loan-servicing` if they target the same action and principal pattern. The example deliberately keeps the two services' policies action-scoped (`Action::"originate"` vs `Action::"service"`) to avoid collisions.

## Deploy order

1. Platform deployed once.
2. `cd examples/multi-context/loan-origination/terraform && terraform apply`
3. `cd examples/multi-context/loan-servicing/terraform && terraform apply`

Either order works — the two roots are independent.
