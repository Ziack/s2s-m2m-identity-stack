// common.cedar — cross-cutting forbids enforced across every bounded context.

// Global sender-constraint gate: every M2M action must prove sender-constraint
// via EITHER a confirmed DPoP proof (sync path) OR a verified message envelope
// (async/SQS path). `envelope_verified` is optional, so guard with `has`.
forbid (
  principal,
  action,
  resource
) unless {
  context.dpop_confirmed == true ||
  (context has envelope_verified && context.envelope_verified == true)
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
