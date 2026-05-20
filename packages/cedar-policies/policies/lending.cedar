// lending.cedar — Lending bounded-context M2M authorization (§3.2 reference set).

// Permit lending-service to create loan applications.
permit (
  principal == M2M::ServicePrincipal::"lending-service-client-id",
  action == M2M::Action::"POST_loan_application",
  resource in M2M::ResourceGroup::"lending-resources"
) when {
  context.dpop_confirmed == true &&
  context.scopes.contains("lending/write") &&
  context.source_domain == "lending"
};

// Permit lending-service to read loan status.
permit (
  principal == M2M::ServicePrincipal::"lending-service-client-id",
  action == M2M::Action::"GET_loan_status",
  resource in M2M::ResourceGroup::"lending-resources"
) when {
  context.dpop_confirmed == true &&
  context.scopes.contains("lending/read") &&
  context.source_domain == "lending"
};

// Time-bounded batch access: batch-processor may read loan status from
// reporting-resources only between 02:00 and 05:00 UTC.
// request_hour is optional in the schema; guard with `has` before comparing.
permit (
  principal == M2M::ServicePrincipal::"batch-processor-client-id",
  action == M2M::Action::"GET_loan_status",
  resource in M2M::ResourceGroup::"reporting-resources"
) when {
  context.dpop_confirmed == true &&
  context.scopes.contains("lending/read") &&
  context.source_domain == "batch" &&
  context has request_hour &&
  context.request_hour >= 2 &&
  context.request_hour <= 5
};
