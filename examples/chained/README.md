# Chained Example — calling → receiving → ledger

Three Node services demonstrating the full S2S exchange chain with a 3-user authorization matrix (alice/bob/carol).

## Architecture

```
User → calling-service (lending/write)
         │  RFC 8693 token-exchange (DPoP-bound)
         ▼
       receiving-service (lending/{read,write})
         │  token-exchange propagating the actor chain
         ▼
       ledger-service (ledger/{read,write})  ← terminal, applies user.roles policy
```

| Service | Bounded context | Inbound scopes | Outbound audiences | Cedar focus |
| --- | --- | --- | --- | --- |
| `calling-service`   | `lending` | `lending/write`                 | `lending`  | originator permits |
| `receiving-service` | `lending` | `lending/write`, `lending/read` | `ledger`   | `user`/`actor_chain` predicates |
| `ledger-service`    | `ledger`  | `ledger/write`, `ledger/read`   | —          | `user.roles` checks |

## Deploy order

1. **Platform once** — `cd modules/s2s-platform && terraform apply`. Outputs land in SSM at `/dev/s2s/platform/*`.
2. **Service terraform — first pass** — for each of `calling-service`, `receiving-service`, `ledger-service`:
   ```bash
   cd examples/chained/<svc>/terraform
   terraform init && terraform apply -var=image_tag=bootstrap
   ```
   The `bootstrap` tag is a placeholder pushed once to give the ECR repo + ECS service something to reference.
3. **Build + push images**:
   ```bash
   cd examples/chained/<svc>
   docker build -t $(terraform -chdir=terraform output -raw ecr_repository_uri):v1 .
   aws ecr get-login-password | docker login --username AWS --password-stdin <repo>
   docker push $(terraform -chdir=terraform output -raw ecr_repository_uri):v1
   ```
4. **Service terraform — second pass** to roll forward:
   ```bash
   cd examples/chained/<svc>/terraform && terraform apply -var=image_tag=v1
   ```
5. **Bootstrap actor catalog** (alice/bob/carol). Reuse the actor-catalog seed script Plan 1 ships at `modules/s2s-platform/scripts/seed-actor-catalog.sh`; pass the three sample users.
6. **Run e2e** — see `./e2e/`.

### VPC Lattice mode (optional)

When the platform is deployed with `enable_lattice = true`, set `-var=enable_lattice=true`
on each chained root to switch the inter-service hops from ALB + plain HTTP to VPC
Lattice + SigV4. In Lattice mode each service publishes its own Lattice DNS to SSM
(`/${env}/s2s/services/<service>/lattice_dns`) and callers consume their callee's DNS,
plus the platform's `broker_lattice_dns`, as task env (`USE_LATTICE`, `*_LATTICE_DNS`,
`BROKER_LATTICE_DNS`).

**Apply order matters in Lattice mode** because a caller reads its callee's published
`lattice_dns` from SSM. Apply callees before callers:

1. `ledger-service` (publishes `ledger-service/lattice_dns`)
2. `receiving-service` (consumes ledger's; publishes `receiving-service/lattice_dns`)
3. `calling-service` (consumes receiving's)

On a first-ever apply the consuming `data.aws_ssm_parameter` lookup will fail if the
callee root hasn't been applied yet — this ordering is the handoff contract for the
example. `enable_lattice` must match the platform's setting (the Lattice SSM params
only exist when the platform enabled Lattice). When `enable_lattice = false`
(default), all Lattice data sources/resources are skipped and the services run the
ALB + plain-fetch path unchanged.

## The 3-user authorization matrix

The canonical demo runs the same `POST /api/loans` flow as three users; the chain decides at the ledger-service:

| User | Roles | Expected outcome | Why |
| --- | --- | --- | --- |
| **alice** | `loan-officer`, `ledger-writer` | `200 OK` — entry written | `lending.cedar` permits the chain; `ledger.cedar` permits `ledger-writer` |
| **bob**   | `loan-officer`                  | `403 partial` — receiving accepts, ledger forbids | `lending.cedar` permits; `ledger.cedar` requires `ledger-writer` |
| **carol** | `reader`                        | `403` at receiving — chain never reaches ledger | `lending.cedar` forbids non-officers |

## Known limitations

- The `calling-service` exposes three top-level paths (`/auth/login`, `/demo/sync`, `/.well-known/jwks.json`) but the `s2s-service` module accepts a single `alb_path_pattern`. The TF root uses `/auth/*`; `/demo/sync` and `/.well-known/jwks.json` are reached via service-discovery DNS inside the VPC. If your deployment needs all three publicly, file an issue against `modules/s2s-service` requesting `additional_alb_path_patterns`.
- The `image_uri` is constructed manually from `account_id`/`region`/`environment`/`image_tag` instead of referencing `module.<svc>.ecr_repository_uri`, because the module both creates the ECR repository and consumes its URI as input — a self-referential cycle. See Plan 3 Checkpoint 1 notes.
