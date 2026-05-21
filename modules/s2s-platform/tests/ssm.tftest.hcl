mock_provider "aws" {
  override_data {
    target = data.aws_iam_policy_document.broker_assume
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ecs-tasks.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}"
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

run "ssm_publishes_scalars" {
  command = plan

  assert {
    condition     = contains(keys(aws_ssm_parameter.scalars), "user_pool_id")
    error_message = "Expected SSM parameter for user_pool_id."
  }
  assert {
    condition     = contains(keys(aws_ssm_parameter.scalars), "broker_url")
    error_message = "Expected SSM parameter for broker_url."
  }
  assert {
    condition     = contains(keys(aws_ssm_parameter.scalars), "kms_secrets_key_arn")
    error_message = "Expected SSM parameter for kms_secrets_key_arn."
  }
}

run "ssm_publishes_json_maps" {
  command = plan

  assert {
    condition     = contains(keys(aws_ssm_parameter.json_maps), "policy_store_ids")
    error_message = "Expected SSM parameter for policy_store_ids as JSON map."
  }
  assert {
    condition     = contains(keys(aws_ssm_parameter.json_maps), "resource_server_identifiers")
    error_message = "Expected SSM parameter for resource_server_identifiers as JSON map."
  }
}

run "ssm_publishes_subnets" {
  command = plan

  assert {
    condition     = aws_ssm_parameter.private_subnet_ids.type == "StringList"
    error_message = "private_subnet_ids must be StringList."
  }
}
