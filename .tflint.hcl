plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# Reserved variables that form the frozen platform input contract (spec §6.1).
# Declared but intentionally unwired in this release.
rule "terraform_unused_declarations" {
  enabled = false
}

plugin "aws" {
  enabled = true
  version = "0.30.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

config {
  call_module_type = "local"
}
