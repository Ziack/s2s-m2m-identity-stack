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

// Phase 5: sync flow — calling-service forwards user identity (loan officer /
// auditor) to receiving-service. POST_loan_application by calling-service
// requires user context AND a permitted role. This is the architectural rule
// that sync flows always carry user context; M2M-only legacy permits above
// remain available for batch / non-interactive paths.
permit (
  principal == M2M::ServicePrincipal::"calling-service",
  action == M2M::Action::"POST_loan_application",
  resource in M2M::ResourceGroup::"lending-resources"
) when {
  context.dpop_confirmed == true &&
  context.scopes.contains("lending/write") &&
  context has user &&
  (context.user.roles.contains("loan-officer") ||
   context.user.roles.contains("auditor"))
};

// Defense in depth: explicitly forbid POST_loan_application when the calling
// user only has reader privileges (no loan-officer or auditor role).
forbid (
  principal,
  action == M2M::Action::"POST_loan_application",
  resource
) when {
  context has user &&
  context.user.roles.contains("reader") &&
  !context.user.roles.contains("loan-officer") &&
  !context.user.roles.contains("auditor")
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
