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

run "broker_task_is_hardened" {
  command = plan

  assert {
    condition     = jsondecode(aws_ecs_task_definition.broker.container_definitions)[0].readonlyRootFilesystem == true
    error_message = "Broker container must have read-only root filesystem."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.broker.container_definitions)[0].user == "1000:1000"
    error_message = "Broker container must run as non-root uid 1000."
  }
  assert {
    condition     = contains(jsondecode(aws_ecs_task_definition.broker.container_definitions)[0].linuxParameters.capabilities.drop, "ALL")
    error_message = "Broker container must drop ALL Linux capabilities."
  }
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.broker.container_definitions)[0].linuxParameters.capabilities.add) == 0
    error_message = "Broker container must not add any capabilities."
  }
}
