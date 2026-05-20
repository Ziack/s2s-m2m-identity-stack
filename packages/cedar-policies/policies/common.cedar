// common.cedar — cross-cutting forbids enforced across every bounded context.

// Global DPoP gate: every M2M action requires a confirmed DPoP proof.
forbid (
  principal,
  action,
  resource
) unless {
  context.dpop_confirmed == true
};

// PII gate: any access to a pii-resources ResourceGroup requires the
// data-privacy/pii-access scope, regardless of any context-specific permit.
forbid (
  principal,
  action,
  resource in M2M::ResourceGroup::"pii-resources"
) unless {
  context.scopes.contains("data-privacy/pii-access")
};
