# RBAC → Cedar translation

Translating common authorization patterns into Cedar policies for AVP. Each example shows the original code, the equivalent Cedar policy, and how the policy fires from `createBrokerAuthMiddleware`'s call to `IsAuthorizedWithToken`.

## 1. Passport-JWT role check

**Before:**

```ts
if (req.user.roles.includes('admin')) {
  // allow
}
```

**After (Cedar):**

```cedar
permit (
  principal,
  action,
  resource
) when {
  context.user.roles.contains("admin")
};
```

`context.user.roles` is populated from the broker token's `user.roles` claim, which the broker copies from the original IdP token.

## 2. Casbin enforce

**Before** — model.conf:

```ini
[matchers]
m = r.sub == p.sub && r.obj == p.obj && r.act == p.act
```

policy.csv:

```csv
p, alice, /reports, read
```

Code: `await enforcer.enforce(sub, obj, act)`.

**After (Cedar):**

```cedar
permit (
  principal == ServicePrincipal::"alice",
  action == Action::"read",
  resource == Resource::"/reports"
);
```

One Casbin policy row becomes one Cedar `permit` statement; the matcher's equality semantics translate directly.

## 3. Hand-rolled tenant guard

**Before:**

```ts
if (req.headers['x-tenant'] === 'acme') {
  // allow
}
```

**After (Cedar):**

```cedar
permit (
  principal,
  action,
  resource
) when {
  context.tenant == "acme"
};
```

`context.tenant` is set by the calling service's actor in the chain; do NOT trust `x-tenant` headers from the edge — populate via broker token claims.

## 4. Express middleware role guard

**Before:**

```ts
function requireRole(role) {
  return (req, res, next) =>
    req.user.roles.includes(role) ? next() : res.status(403).end();
}

app.post('/orders', requireRole('manager'), createOrder);
```

**After (Cedar):**

```cedar
permit (
  principal,
  action == Action::"createOrder",
  resource
) when {
  context.user.roles.contains("manager")
};
```

Drop the middleware — the broker-auth middleware enforces.

## 5. ABAC dept match

**Before:**

```ts
if (user.dept === resource.dept) {
  // allow
}
```

**After (Cedar):**

```cedar
permit (
  principal,
  action,
  resource
) when {
  context.user.dept == resource.dept
};
```

Requires the resource entity to include a `dept` attribute in the AVP `entities` payload. Shape:

```json
{
  "entities": [
    {
      "identifier": { "entityType": "Resource", "entityId": "report-123" },
      "attributes": { "dept": { "string": "engineering" } }
    }
  ]
}
```

## Edge cases

- **Deny-by-default.** Cedar is deny-by-default; if no `permit` matches, the request is denied. You never write `forbid` for "no opinion".
- **Multi-condition `when`.** Chain with `&&`:
  ```cedar
  permit ( principal, action, resource )
  when { context.user.roles.contains("manager") && context.tenant == "acme" };
  ```
- **`forbid` always wins.** A `forbid` policy overrides any matching `permit`. Use sparingly for hard guardrails (e.g. `forbid` when `context.user.suspended == true`).
