// Casbin role grouping → broker token `user.roles` claim.
// Translates the policy.csv rows from before/casbin/policy.csv.

permit (
  principal,
  action == Action::"readReports",
  resource
) when {
  context.user.roles.contains("analyst") || context.user.roles.contains("admin")
};

permit (
  principal,
  action == Action::"writeReports",
  resource
) when {
  context.user.roles.contains("admin")
};

permit (
  principal,
  action == Action::"deleteReport",
  resource
) when {
  context.user.roles.contains("admin")
};
