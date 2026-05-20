// accounts.cedar — Accounts bounded-context M2M authorization.

permit (
  principal == M2M::ServicePrincipal::"accounts-service-client-id",
  action in [M2M::Action::"POST_account", M2M::Action::"GET_account"],
  resource in M2M::ResourceGroup::"accounts-resources"
) when {
  context.dpop_confirmed == true &&
  context.source_domain == "accounts" &&
  ((action == M2M::Action::"POST_account" && context.scopes.contains("accounts/write")) ||
   (action == M2M::Action::"GET_account" && context.scopes.contains("accounts/read")))
};

// Closed accounts cannot be mutated.
forbid (
  principal,
  action == M2M::Action::"POST_account",
  resource in M2M::ResourceGroup::"accounts-closed"
);
