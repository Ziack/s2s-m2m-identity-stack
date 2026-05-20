// deposits.cedar — Deposits bounded-context M2M authorization.

permit (
  principal == M2M::ServicePrincipal::"deposits-service-client-id",
  action in [M2M::Action::"POST_deposit", M2M::Action::"GET_deposit"],
  resource in M2M::ResourceGroup::"deposits-resources"
) when {
  context.dpop_confirmed == true &&
  context.source_domain == "deposits" &&
  ((action == M2M::Action::"POST_deposit" && context.scopes.contains("deposits/write")) ||
   (action == M2M::Action::"GET_deposit" && context.scopes.contains("deposits/read")))
};

// High-value deposits require an explicit scope above and beyond write.
forbid (
  principal,
  action,
  resource in M2M::ResourceGroup::"deposits-high-value"
) unless {
  context.scopes.contains("deposits/high-value")
};
