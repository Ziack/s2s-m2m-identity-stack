# Postman collection — S2S Identity Stack

A happy-path test collection for the `examples/chained/` deployment. Demonstrates the **three-user × three-outcomes** matrix without DPoP scripting.

## What it tests

| Folder | User | Roles | Expected |
|---|---|---|---|
| `Sanity checks` | — | — | health, JWKS, OIDC, /metrics, test-user list all reachable |
| `Alice — full ALLOW` | alice | loan-officer + reader | 200 with `ledger.audit.user_sub = "user-alice"` + 2-hop `actor_chain` |
| `Bob — receiving ALLOW, ledger DENY` | bob | auditor + reader | 502 with `error: "downstream_unavailable"` (ledger denied bob; receiving surfaces as downstream failure) |
| `Carol — receiving DENY` | carol | reader only | 403 with `error: "authorization_denied"` (Cedar denies at the first hop) |
| `Bonus — async (alice)` | alice | loan-officer | 202 with `correlation_id` (verify outcome in CloudWatch) |

The collection's pre-request scripts log in each user once per folder and capture the user token into a collection variable, so the `/demo/sync` request can reference `{{alice_token}}` etc. without manual copy-paste.

## Setup

1. **Deploy the stack** first. The collection assumes:
   - Platform deployed (`module "s2s_platform"`)
   - All three chained services deployed (`examples/chained/{calling,receiving,ledger}-service/`)
   - Cognito secret bootstrap complete + actor catalog populated (the orchestrator script does this)
   - Real ECR images pushed for all three services

2. **Capture the ALB DNS:**
   ```bash
   cd examples/chained/calling-service/terraform
   terraform output service_url
   # → http://my-alb-1234.us-east-1.elb.amazonaws.com/api/loans
   # Drop the path; keep only the host
   ```

3. **Import the collection:**
   - In Postman: File → Import → `docs/postman/s2s-stack.postman_collection.json`

4. **Set collection variables:**
   - `alb` → the ALB DNS (no scheme, no path, no trailing slash). Example: `my-alb-1234.us-east-1.elb.amazonaws.com`
   - `scheme` → `http` for an internal ALB; `https` if you've wired ACM

## Run order

Run the folders in any order — each folder is self-contained:
1. `Sanity checks` first to confirm reachability
2. `Alice — full ALLOW` for the happy-path demo
3. `Bob — ledger DENY` to see the chain break at the deepest hop
4. `Carol — receiving DENY` to see the chain break at the first hop
5. `Bonus — async` to test the SQS envelope path

Each runner-style execution should show **all green tests** if the stack is healthy.

## What the collection deliberately does NOT do

- **Hit `/api/loans` or `/api/ledger/entries` directly** — those require DPoP-signed requests (RFC 9449). DPoP requires an EC P-256 key pair and JWS proof signed per-request. The architecture is: client apps go through the calling-service, which does all the DPoP crypto internally.
- **Call the broker's `/oauth2/token` directly** — RFC 8693 token exchange works, but the returned token is DPoP-bound. You'd need to sign a proof to use it. The calling-service hides this complexity.
- **Verify CloudWatch log assertions** — the async-flow test returns 202 immediately; verification of the envelope receipt is in CloudWatch logs of the receiving-service consumer.

## Want DPoP-signed direct calls?

If you genuinely need to test `/api/loans` directly without the calling-service in front, you'd need a Postman pre-request script using a JS jose-style library. Sketch:

```js
// In Postman pre-request:
// 1. Generate or retrieve a stored EC P-256 key pair (jwkstore in Postman environment)
// 2. Compute ath = base64url(sha256(accessToken))
// 3. Sign JWS with header { typ: "dpop+jwt", alg: "ES256", jwk: <pub> }
//    payload { htm, htu, iat: now, jti: uuid, ath, nonce? }
// 4. Set headers:
//    Authorization: DPoP <accessToken>
//    DPoP: <signed-proof>
// 5. On 401 with DPoP-Nonce header, re-sign with the nonce and retry
```

If we ship a DPoP-signing helper for Postman later, it'll live at `docs/postman/dpop-signing.postman_script.js`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 502 on Sanity Check /health | ALB DNS wrong, ECS task not running, or service health check failing |
| 401 on /demo/sync with valid Bearer | calling-service can't validate the user token — check `USER_ISSUER_URL` env points at the calling-service's own JWKS endpoint |
| 401 from broker exchange | actor catalog not bootstrapped — re-run `examples/chained/e2e/scripts/deploy-and-test.sh` step 5 |
| All requests return DPoP-Nonce 401 | DPoP nonce store (Redis) not reachable from receiving/ledger task |
| 403 with `authorization_denied` for alice | Cedar policies not uploaded to AVP — re-run `@s2s/cedar-tooling upload` against your policy stores |

## Variables reference

| Variable | Set in | Purpose |
|---|---|---|
| `alb` | Collection scope | Hostname of the ALB serving all services |
| `scheme` | Collection scope | http/https |
| `alice_token`, `bob_token`, `carol_token` | Collection scope (auto-set) | Captured by the login pre-request script |
