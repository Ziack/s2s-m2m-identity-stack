// ledger.cedar — Ledger bounded-context M2M authorization.
//
// Distinguishing trait: the ledger service is a downstream-only consumer,
// reached from receiving-service via an outbound OAuth client
// (`receiving-service-outbound`). Audit-service has read-only access.

// Phase 5: receiving-service-outbound writes ledger entries on behalf of the
// originating user. We require:
//   - the propagated user holds the loan-officer role
//   - the actor_chain proves the request originated at calling-service
//     (defense in depth against direct service-to-ledger calls bypassing the
//      sync entry point)
permit (
  principal == M2M::ServicePrincipal::"receiving-service-outbound",
  action == M2M::Action::"POST_ledger_entry",
  resource in M2M::ResourceGroup::"ledger-resources"
) when {
  context.dpop_confirmed == true &&
  context.scopes.contains("ledger/write") &&
  context has user &&
  context.user.roles.contains("loan-officer") &&
  context has actor_chain &&
  context.actor_chain.contains("calling-service")
};

// Defense in depth: forbid any principal from writing ledger entries when the
// propagated user lacks the loan-officer role.
forbid (
  principal,
  action == M2M::Action::"POST_ledger_entry",
  resource
) when {
  context has user &&
  !context.user.roles.contains("loan-officer")
};

// Permit audit-service to read individual ledger entries.
permit (
  principal == M2M::ServicePrincipal::"audit-service",
  action == M2M::Action::"GET_ledger_entry",
  resource in M2M::ResourceGroup::"ledger-resources"
) when {
  context.dpop_confirmed == true &&
  context.scopes.contains("ledger/read")
};

// Permit audit-service to list ledger entries.
permit (
  principal == M2M::ServicePrincipal::"audit-service",
  action == M2M::Action::"LIST_ledger_entries",
  resource in M2M::ResourceGroup::"ledger-resources"
) when {
  context.dpop_confirmed == true &&
  context.scopes.contains("ledger/read")
};
