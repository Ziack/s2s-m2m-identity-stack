# S2S Examples

Reference implementations using the `s2s-platform` and `s2s-service` Terraform modules.

| Example | What it shows |
| --- | --- |
| [`basic/`](./basic/) | Single service, minimal config — the smallest possible `module "s2s_service"` call. |
| [`chained/`](./chained/) | Three services (`calling` → `receiving` → `ledger`) demonstrating the full DPoP-bound exchange chain plus the alice/bob/carol authorization matrix. |
| [`multi-context/`](./multi-context/) | Two services sharing one bounded context (`lending`) — separate identities, unioned Cedar policies. |

Each example's `terraform/` directory is independently validatable (`terraform init -backend=false && terraform validate`) and is executed by CI on every PR.
