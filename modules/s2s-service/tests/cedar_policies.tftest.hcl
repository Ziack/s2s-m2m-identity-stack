mock_provider "aws" {
  override_data {
    target = data.aws_iam_policy_document.assume
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ecs-tasks.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}"
    }
  }
  override_data {
    target = data.aws_iam_policy_document.task
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
  override_resource {
    target = aws_lb_target_group.this
    values = {
      arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/test-svc/2222222222222222"
    }
  }
  override_resource {
    target = aws_iam_role.task
    values = {
      arn = "arn:aws:iam::123456789012:role/svc-task"
    }
  }
  override_resource {
    target = aws_iam_role.execution
    values = {
      arn = "arn:aws:iam::123456789012:role/svc-exec"
    }
  }
  override_resource {
    target = aws_secretsmanager_secret.client_secret
    values = {
      arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:svc-secret-AbCdEf"
    }
  }
}
mock_provider "random" {}

variables {
  service_name               = "loan-origination"
  bounded_context            = "lending"
  scopes                     = ["lending/write"]
  image_uri                  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/dev/loan-origination:latest"
  alb_path_pattern           = "/api/loans/*"
  alb_listener_rule_priority = 100
  outbound_audiences         = []
  env                        = {}
  cedar_policies = [
    { name = "permit-loan-write", statement = "permit(principal, action, resource);", description = "test1" },
    { name = "forbid-reader-read", statement = "forbid(principal, action, resource);", description = "test2" },
  ]
  platform = {
    account_id                 = "123456789012"
    region                     = "us-east-1"
    environment                = "dev"
    user_pool_id               = "us-east-1_FAKE"
    cognito_domain             = "fake.auth.us-east-1.amazoncognito.com"
    broker_url                 = "https://fake-alb.internal"
    broker_jwks_uri            = "https://fake-alb.internal/.well-known/jwks.json"
    broker_token_endpoint      = "https://fake-alb.internal/oauth2/token"
    broker_issuer              = "https://fake-alb.internal"
    kms_secrets_key_arn        = "arn:aws:kms:us-east-1:123456789012:key/abcd-fake"
    redis_endpoint             = "fake.cache.amazonaws.com"
    redis_port                 = 6379
    alb_dns_name               = "fake-alb.internal"
    alb_listener_arn           = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/fake/abc/def"
    alb_security_group_id      = "sg-alb-fake"
    workload_security_group_id = "sg-workload-fake"
    ecs_cluster_arn            = "arn:aws:ecs:us-east-1:123456789012:cluster/fake"
    ecs_cluster_name           = "fake-cluster"
    vpc_id                     = "vpc-fake"
    private_subnet_ids         = ["subnet-fake-a", "subnet-fake-b"]
    policy_store_id            = "ps-fake-lending"
    resource_server_identifier = "lending"
    enable_lattice             = false
    lattice_service_network_id = null
    broker_lattice_dns         = null
    sidecars                   = []
    sidecar_iam_statements     = []
    sidecar_volumes            = []
  }
}

run "uploads_both_cedar_policies" {
  command = plan

  assert {
    condition     = length(aws_verifiedpermissions_policy.cedar) == 2
    error_message = "Expected 2 Cedar policies to be created."
  }
  assert {
    condition     = contains(keys(aws_verifiedpermissions_policy.cedar), "permit-loan-write")
    error_message = "Expected permit-loan-write policy key."
  }
  assert {
    condition     = contains(keys(aws_verifiedpermissions_policy.cedar), "forbid-reader-read")
    error_message = "Expected forbid-reader-read policy key."
  }
}
