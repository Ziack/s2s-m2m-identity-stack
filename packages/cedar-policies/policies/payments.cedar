// payments.cedar — Payments bounded-context M2M authorization.

permit (
  principal == M2M::ServicePrincipal::"payments-service-client-id",
  action in [M2M::Action::"POST_payment", M2M::Action::"GET_payment"],
  resource in M2M::ResourceGroup::"payments-resources"
) when {
  context.dpop_confirmed == true &&
  context.source_domain == "payments" &&
  ((action == M2M::Action::"POST_payment" && context.scopes.contains("payments/write")) ||
   (action == M2M::Action::"GET_payment" && context.scopes.contains("payments/read")))
};

// Hard forbid: sanctioned recipients cannot receive payments via this stack.
forbid (
  principal,
  action == M2M::Action::"POST_payment",
  resource in M2M::ResourceGroup::"payments-sanctioned"
);
