// Origination half of the lending bounded context.
// Permits loan-officers to originate; forbids anyone without that role.
permit (
    principal,
    action == Action::"originate",
    resource
) when {
    principal has roles && principal.roles.contains("loan-officer")
};

forbid (
    principal,
    action == Action::"originate",
    resource
) unless {
    principal has roles && principal.roles.contains("loan-officer")
};
