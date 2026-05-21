# Basic example

Single-service smoke example. Looks up the platform via SSM and deploys one service called `loan-origination` in the `lending` bounded context.

## Usage

```bash
cd examples/basic
terraform init
terraform validate
terraform plan -var-file=fixtures/example.tfvars
```

Assumes the platform module is already deployed and SSM parameters are populated.
