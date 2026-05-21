# Cedar Authoring Guide

How to write Cedar policies against the v2 S2S Cedar schema.

## Schema overview

The v2 schema lives in `packages/cedar-policies/schema.cedarschema` and is
the source of truth. Highlights:

```cedar
namespace M2M {
  entity ServicePrincipal = {
    client_id: String,
    bounded_context: String,
  };
  entity User = {
    user_id: String,
    role: String,
  };

  action "lending/loans/read", "lending/loans/write", "payments/transfer", ...
    appliesTo {
      principal: [ServicePrincipal],
      resource:  [ServicePrincipal],
      context: {
        request_hour: Long,
        user: User,
        actor_chain: Set<{ client_id: String, bounded_context: String }>,
      }
    };
}
```

Action names follow the convention `<bounded-context>/<resource>/<verb>`
(e.g. `lending/loans/read`). The broker derives the action from the requested
scope; any scope outside this pattern is rejected pre-AVP.

## Context fields (v2 additions)

`context.user` — the **end-user principal** propagated across the actor chain.
The broker extracts this from the original ID token presented to the first
service in the chain and forwards it via the `act` claim in each exchanged
access token (per RFC 8693 §2.2.1).

`context.actor_chain` — the **ordered list of upstream service principals**.
Index 0 is the immediate caller; the last element is the chain's root. Use
this for "did this request originate from service X" decisions.

`context.request_hour` — integer 0–23 in UTC, set by the broker. Used for
time-of-day FORBID rules.

## Policy patterns

### PERMIT — gated by user role

```cedar
permit (
  principal in M2M::ServicePrincipal::"loan-app-789",
  action == M2M::Action::"lending/loans/write",
  resource
)
when {
  context.user.role == "loan-officer"
};
```

### PERMIT — gated by immediate caller

```cedar
permit (
  principal,
  action == M2M::Action::"lending/loans/read",
  resource == M2M::ServicePrincipal::"ledger-service-456"
)
when {
  context.actor_chain[0].client_id == "calling-service-123"
};
```

### FORBID — block reads from outside the bounded context

```cedar
forbid (
  principal,
  action == M2M::Action::"lending/loans/read",
  resource
)
unless {
  context.actor_chain[0].bounded_context == "lending"
};
```

### Time-bounded — block writes outside business hours

```cedar
forbid (
  principal,
  action == M2M::Action::"lending/loans/write",
  resource
)
when {
  context.request_hour < 8 || context.request_hour >= 18
};
```

## Migrating v1 policies

In v1, the immediate caller's client_id was at `context.client_id`. In v2,
the same value lives at `context.actor_chain[0].client_id`, but the chain
also includes any upstream callers further back. Rewrite:

```cedar
// v1
when { context.client_id == "calling-service-123" };

// v2
when { context.actor_chain[0].client_id == "calling-service-123" };
```

If a v1 policy intended "the caller chain must NOT include service X" (which
v1 couldn't express), use the v2 `Set.contains`:

```cedar
forbid (
  principal,
  action,
  resource
)
when {
  context.actor_chain.contains(
    { client_id: "deprecated-legacy-svc", bounded_context: "lending" }
  )
};
```

## Linting + deploying

```bash
# Lint locally
npx @s2s/cedar-tooling lint policies/

# Dry-run against the schema
npx @s2s/cedar-tooling validate policies/ --schema packages/cedar-policies/schema.cedarschema

# Push to AVP
npx @s2s/cedar-tooling upload \
  --policy-store-id "<from-terraform-output>" \
  --policies policies/
```

The CLI is idempotent: it diffs the local policies against the policy store
and only creates/updates/deletes what changed. Policy resources in AVP are
**replaced** on update (see spec §10.6 — this means policy churn for
frequently-edited policies; consider versioning policies by file rather than
in-place editing for high-churn cases).
