// ledger.cedar — Ledger bounded-context M2M authorization.
//
// Distinguishing trait: the ledger service is a downstream-only consumer,
// reached from receiving-service via an outbound OAuth client
// (`receiving-service-outbound`). Audit-service has read-only access.

// Permit receiving-service-outbound to write ledger entries.
permit (
  principal == M2M::ServicePrincipal::"receiving-service-outbound",
  action == M2M::Action::"POST_ledger_entry",
  resource in M2M::ResourceGroup::"ledger-resources"
) when {
  context.dpop_confirmed == true &&
  context.scopes.contains("ledger/write")
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
