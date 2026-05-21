# `examples/_bootstrap/` — minimal VPC for PoC/dev deployments

A turnkey Terraform root that creates a small, opinionated VPC suitable for
standing up the S2S Identity Stack in an empty AWS account for a proof of
concept or a developer environment.

If you already have a VPC with private subnets in two AZs and NAT egress,
**skip this root entirely** — go straight to
[`examples/_platform/`](../_platform/) and plug your existing IDs into its
`dev.tfvars.json`.

The underscore prefix (`_bootstrap/`) sorts it to the top of `examples/` and
signals "infrastructure, not a service example".

## Who needs this

| Audience | Use `_bootstrap/`? |
| --- | --- |
| PoC in an empty sandbox account | **Yes** |
| Local-dev personal account, no existing VPC | **Yes** |
| Shared dev account that already has networking | No — reuse it |
| Staging / prod | **No** — bring your own VPC with multi-AZ NAT, flow logs, Transit Gateway, etc. |

## What it creates

| Resource | Count | Notes |
| --- | --- | --- |
| `aws_vpc` | 1 | `10.0.0.0/16` by default, DNS hostnames + support on |
| `aws_subnet` public | 2 | `/20` slots, one per AZ, `map_public_ip_on_launch = true` |
| `aws_subnet` private | 2 | `/20` slots, one per AZ |
| `aws_internet_gateway` | 1 | |
| `aws_eip` | 1 | For the NAT gateway |
| `aws_nat_gateway` | 1 | **Single AZ — SPOF.** Acceptable for PoC, not prod |
| `aws_route_table` | 2 | Public (→ IGW) + private (→ NAT) |
| `aws_route_table_association` | 4 | Two per route table |

### AWS cost note

The NAT gateway dominates the bill at this scale:

- NAT gateway: **~$32/month** (24/7 hourly charge) + **$0.045 / GB processed**
- EIP for NAT: free while attached
- Everything else (VPC, subnets, IGW, route tables): no hourly charge

Run `tofu destroy` when you are done to stop the NAT meter.

## Apply flow

```bash
cd examples/_bootstrap

# 1. Copy + edit the fixture (region, environment, optional vpc_cidr + tags).
cp fixtures/dev.tfvars.json.example fixtures/dev.tfvars.json
$EDITOR fixtures/dev.tfvars.json

# 2. Init + apply.
tofu init
tofu apply -var-file=fixtures/dev.tfvars.json
```

## Handing off to `examples/_platform/`

After apply, the root prints a `next_steps` output that contains the exact
JSON blob the platform fixture wants. Extract it:

```bash
tofu output -json next_steps | jq -r '. | fromjson'
```

Output looks like:

```json
{
  "vpc_id": "vpc-0123456789abcdef0",
  "private_subnet_ids": ["subnet-aaa…", "subnet-bbb…"],
  "alb_subnet_ids":     ["subnet-ccc…", "subnet-ddd…"]
}
```

Paste those three keys into
`examples/_platform/fixtures/dev.tfvars.json` and proceed with the platform
apply (see [`docs/deploying-the-stack.md`](../../docs/deploying-the-stack.md)).

## Teardown

Order matters — destroy in reverse of apply, otherwise the platform's ALB +
ECS service will block VPC deletion:

```bash
# 1. Destroy each service example first
cd examples/chained/<service>/terraform && tofu destroy …

# 2. Destroy the platform
cd examples/_platform && tofu destroy -var-file=fixtures/dev.tfvars.json

# 3. Finally, destroy the bootstrap VPC
cd examples/_bootstrap && tofu destroy -var-file=fixtures/dev.tfvars.json
```

## What this is NOT

This root is deliberately the smallest VPC that lets the platform come up.
It does **not** include:

- Multi-AZ NAT (single NAT in one public subnet → SPOF)
- Transit Gateway, VPN, or Direct Connect attachments
- VPC peering
- IPv6 dual-stack
- VPC flow logs / CloudWatch log group
- VPC endpoints (S3, ECR, SSM, …) — egress goes through the NAT
- DHCP option sets beyond AWS defaults
- Network ACLs beyond the default allow-all
- Tag standards / cost-allocation enforcement
- Private hosted zone or Route 53 resolver rules

Real prod deployments should bring their own VPC built with whatever
networking tool the org already standardises on (Terraform module library,
CloudFormation StackSet, AWS Network Firewall, etc.) and skip this root.
