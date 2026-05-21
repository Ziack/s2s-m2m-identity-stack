mock_provider "aws" {
  override_data {
    target = data.aws_iam_policy_document.broker_assume
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ecs-tasks.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}"
    }
  }
  override_data {
    target = data.aws_iam_policy_document.broker_lattice_auth
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"AllowInvokeFromAccount\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"*\"},\"Action\":\"vpc-lattice-svcs:Invoke\",\"Resource\":\"*\",\"Condition\":{\"StringEquals\":{\"aws:PrincipalAccount\":\"123456789012\"}}}]}"
    }
  }
  override_data {
    target = data.aws_iam_policy_document.broker_lattice_infra_assume
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ecs.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}"
    }
  }
  override_data {
    target = data.aws_iam_policy_document.broker_lattice_infra
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"vpc-lattice:RegisterTargets\",\"Resource\":\"*\"}]}"
    }
  }
  override_resource {
    target = aws_cognito_user_pool.this
    values = {
      id       = "us-east-1_TESTPOOL"
      arn      = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_TESTPOOL"
      endpoint = "cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL"
    }
  }
  override_resource {
    target = aws_acm_certificate.alb
    values = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
    }
  }
  override_resource {
    target = aws_elasticache_serverless_cache.this
    values = {
      endpoint = [{ address = "valkey.local", port = 6379 }]
    }
  }
  override_resource {
    target = aws_lb.this
    values = {
      arn      = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/test-alb/0000000000000000"
      dns_name = "test-alb.us-east-1.elb.amazonaws.com"
    }
  }
  override_resource {
    target = aws_iam_role.broker_execution
    values = {
      arn = "arn:aws:iam::123456789012:role/broker-execution"
    }
  }
  override_resource {
    target = aws_iam_role.broker_task
    values = {
      arn = "arn:aws:iam::123456789012:role/broker-task"
    }
  }
  override_resource {
    target = aws_lb_listener.this
    values = {
      arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/test-alb/0000000000000000/1111111111111111"
    }
  }
  override_resource {
    target = aws_lb_target_group.broker
    values = {
      arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/test-broker/2222222222222222"
    }
  }
  override_resource {
    target = aws_vpclattice_service_network.this
    values = {
      id  = "sn-0000000000000000"
      arn = "arn:aws:vpc-lattice:us-east-1:123456789012:servicenetwork/sn-0000000000000000"
    }
  }
  override_resource {
    target = aws_vpclattice_service.broker
    values = {
      id        = "svc-0000000000000000"
      arn       = "arn:aws:vpc-lattice:us-east-1:123456789012:service/svc-0000000000000000"
      dns_entry = [{ domain_name = "test-s2s-broker.svc-0000000000000000.vpc-lattice-svcs.us-east-1.on.aws", hosted_zone_id = "Z00000000000000000000" }]
    }
  }
  override_resource {
    target = aws_iam_role.broker_lattice_infra
    values = {
      arn = "arn:aws:iam::123456789012:role/broker-lattice-infra"
    }
  }
  override_resource {
    target = aws_vpclattice_target_group.broker
    values = {
      arn = "arn:aws:vpc-lattice:us-east-1:123456789012:targetgroup/tg-0000000000000000"
    }
  }
  override_resource {
    target = aws_s3_bucket.lattice_logs
    values = {
      arn = "arn:aws:s3:::test-s2s-lattice-logs-123456789012-us-east-1"
    }
  }
  override_resource {
    target = aws_cloudwatch_log_group.lattice_access
    values = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/vpclattice/test-s2s"
    }
  }
}
mock_provider "tls" {}
mock_provider "random" {}

variables {
  region                = "us-east-1"
  account_id            = "123456789012"
  environment           = "test"
  vpc_id                = "vpc-test"
  private_subnet_ids    = ["subnet-a", "subnet-b"]
  alb_subnet_ids        = ["subnet-a", "subnet-b"]
  bounded_contexts      = ["lending"]
  user_issuer_url       = "https://idp.example.com"
  broker_image_uri      = "ghcr.io/ziack/s2s-token-broker:v2.0.0"
  cognito_domain_prefix = "s2s-test"
}

# (a) Disabled: no Lattice resources created, broker stays ALB-only.
run "lattice_disabled_creates_nothing" {
  command = plan

  variables {
    enable_lattice = false
  }

  assert {
    condition     = length(aws_vpclattice_service_network.this) == 0
    error_message = "Service network must not exist when enable_lattice = false."
  }
  assert {
    condition     = length(aws_vpclattice_service_network_vpc_association.this) == 0
    error_message = "VPC association must not exist when disabled."
  }
  assert {
    condition     = length(aws_vpclattice_service.broker) == 0
    error_message = "Broker Lattice service must not exist when disabled."
  }
  assert {
    condition     = length(aws_vpclattice_target_group.broker) == 0
    error_message = "Broker Lattice target group must not exist when disabled."
  }
  assert {
    condition     = length(aws_vpclattice_listener.broker) == 0
    error_message = "Broker Lattice listener must not exist when disabled."
  }
  assert {
    condition     = length(aws_vpclattice_auth_policy.broker) == 0
    error_message = "Broker auth policy must not exist when disabled."
  }
  assert {
    condition     = length(aws_s3_bucket.lattice_logs) == 0
    error_message = "Lattice access-log bucket must not exist when disabled."
  }
  assert {
    condition     = length(aws_iam_role.broker_lattice_infra) == 0
    error_message = "Lattice infra role must not exist when disabled."
  }
  assert {
    condition     = length(aws_ecs_service.broker.vpc_lattice_configurations) == 0
    error_message = "Broker ECS service must not have a vpc_lattice_configurations block when disabled."
  }
  assert {
    condition     = !contains(keys(aws_ssm_parameter.lattice_scalars), "lattice_service_network_id")
    error_message = "No Lattice SSM params should be published when disabled."
  }
}

# (b) Enabled: service network + broker service + TG + listener + VPC assoc all present.
run "lattice_enabled_creates_resources" {
  command = plan

  variables {
    enable_lattice = true
  }

  assert {
    condition     = length(aws_vpclattice_service_network.this) == 1
    error_message = "Expected 1 service network when enabled."
  }
  assert {
    condition     = aws_vpclattice_service_network.this[0].auth_type == "AWS_IAM"
    error_message = "Service network must use AWS_IAM auth."
  }
  assert {
    condition     = length(aws_vpclattice_service_network_vpc_association.this) == 1
    error_message = "Expected 1 VPC association when enabled."
  }
  assert {
    condition     = length(aws_vpclattice_service.broker) == 1
    error_message = "Expected the broker Lattice service when enabled."
  }
  assert {
    condition     = aws_vpclattice_service.broker[0].auth_type == "AWS_IAM"
    error_message = "Broker Lattice service must use AWS_IAM auth."
  }
  assert {
    condition     = length(aws_vpclattice_service_network_service_association.broker) == 1
    error_message = "Broker service must be associated to the service network."
  }
  assert {
    condition     = length(aws_vpclattice_target_group.broker) == 1
    error_message = "Expected the broker IP target group when enabled."
  }
  assert {
    condition     = aws_vpclattice_target_group.broker[0].type == "IP"
    error_message = "Broker Lattice target group must be type IP."
  }
  assert {
    condition     = aws_vpclattice_target_group.broker[0].config[0].port == 8080
    error_message = "Broker target group must target port 8080."
  }
  assert {
    condition     = aws_vpclattice_target_group.broker[0].config[0].health_check[0].path == "/health"
    error_message = "Broker target group health check must hit /health."
  }
  assert {
    condition     = length(aws_vpclattice_listener.broker) == 1
    error_message = "Expected the broker listener when enabled."
  }
  assert {
    condition     = length(aws_vpclattice_auth_policy.broker) == 1
    error_message = "Expected the broker auth policy when enabled."
  }
  assert {
    condition     = length(aws_iam_role.broker_lattice_infra) == 1
    error_message = "Expected the ECS Lattice registration role when enabled."
  }
  assert {
    condition     = length(aws_ecs_service.broker.vpc_lattice_configurations) == 1
    error_message = "Broker ECS service must carry a vpc_lattice_configurations block when enabled."
  }
  assert {
    condition     = length(aws_s3_bucket.lattice_logs) == 1 && length(aws_cloudwatch_log_group.lattice_access) == 1
    error_message = "Access-log bucket + CW log group must exist when enabled."
  }
  assert {
    condition     = length(aws_vpclattice_access_log_subscription.s3) == 1 && length(aws_vpclattice_access_log_subscription.cw) == 1
    error_message = "Both access-log subscriptions must exist when enabled."
  }
}
