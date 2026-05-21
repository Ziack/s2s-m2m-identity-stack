# CI snippet — additions to `.github/workflows/pr.yml`

Plan 5 applies these as part of the v2 release commit.

## New job: validate examples/

```yaml
jobs:
  validate-examples:
    name: terraform-validate (examples)
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        path:
          - examples/basic/hello-loans/terraform
          - examples/chained/calling-service/terraform
          - examples/chained/receiving-service/terraform
          - examples/chained/ledger-service/terraform
          - examples/multi-context/loan-origination/terraform
          - examples/multi-context/loan-servicing/terraform
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.6.6"
      - name: terraform init -backend=false
        working-directory: ${{ matrix.path }}
        run: terraform init -backend=false
      - name: terraform validate
        working-directory: ${{ matrix.path }}
        run: terraform validate
      - name: terraform fmt -check -recursive
        working-directory: ${{ matrix.path }}
        run: terraform fmt -check -recursive
```

## Extension to the existing test job

Add these example workspaces to the test matrix Plan 5 already wires for `packages/*`:

```yaml
- examples/basic/hello-loans
- examples/chained/calling-service
- examples/chained/receiving-service
- examples/chained/ledger-service
- examples/chained/e2e
- examples/multi-context/loan-origination
- examples/multi-context/loan-servicing
```

The `examples/chained/e2e` workspace is intentionally skipped at runtime (`S2S_E2E=1` gate) but its `npm test` still must exit 0.
