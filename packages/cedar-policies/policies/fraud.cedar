// fraud.cedar — Fraud bounded-context M2M authorization.

permit (
  principal == M2M::ServicePrincipal::"fraud-service-client-id",
  action in [M2M::Action::"POST_fraud_signal", M2M::Action::"GET_fraud_case"],
  resource in M2M::ResourceGroup::"fraud-resources"
) when {
  context.dpop_confirmed == true &&
  context.source_domain == "fraud" &&
  ((action == M2M::Action::"POST_fraud_signal" && context.scopes.contains("fraud/write")) ||
   (action == M2M::Action::"GET_fraud_case" && context.scopes.contains("fraud/read")))
};

// Closed fraud cases are immutable.
forbid (
  principal,
  action == M2M::Action::"POST_fraud_signal",
  resource in M2M::ResourceGroup::"fraud-cases-closed"
);
