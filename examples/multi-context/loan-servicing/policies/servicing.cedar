// Servicing half of the lending bounded context.
// Permits loan-officers AND loan-servicers to service existing loans.
permit (
    principal,
    action == Action::"service",
    resource
) when {
    principal has roles &&
    (principal.roles.contains("loan-officer") || principal.roles.contains("loan-servicer"))
};
