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
  bounded_context            = "lending"
  scopes                     = ["lending/write"]
  image_uri                  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/dev/svc:latest"
  alb_path_pattern           = "/api/svc/*"
  alb_listener_rule_priority = 100
  outbound_audiences         = []
  env                        = {}
  cedar_policies             = []
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
    sidecars = [
      { name = "universal", image = "x:1", essential = false, cpu = 0, memory = 0, environment = [], secrets = [], mount_points = [], port_mappings = [], depends_on = [], mandatory = true, opt_out_services = [], opt_in_services = [] },
      { name = "targeted", image = "x:1", essential = false, cpu = 0, memory = 0, environment = [], secrets = [], mount_points = [], port_mappings = [], depends_on = [], mandatory = false, opt_out_services = [], opt_in_services = ["loan-origination"] },
      { name = "broker_skip", image = "x:1", essential = false, cpu = 0, memory = 0, environment = [], secrets = [], mount_points = [], port_mappings = [], depends_on = [], mandatory = true, opt_out_services = ["token-broker"], opt_in_services = [] },
    ]
    sidecar_iam_statements = [
      { sidecar_name = "universal", effect = "Allow", actions = ["s3:GetObject"], resources = ["*"] },
      { sidecar_name = "targeted", effect = "Allow", actions = ["sqs:SendMessage"], resources = ["*"] },
    ]
    sidecar_volumes = []
  }
}

run "loan_origination_gets_universal_and_targeted_and_broker_skip" {
  command = plan
  variables { service_name = "loan-origination" }
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.this.container_definitions)) == 4
    error_message = "Expected 1 main + 3 sidecars = 4 containers."
  }
  assert {
    condition     = anytrue([for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.name == "targeted"])
    error_message = "loan-origination must receive the targeted sidecar."
  }
}

run "token_broker_skips_broker_skip_and_targeted" {
  command = plan
  variables { service_name = "token-broker" }
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.this.container_definitions)) == 2
    error_message = "token-broker must receive only universal sidecar (1 main + 1 sidecar)."
  }
  assert {
    condition     = !anytrue([for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.name == "broker_skip"])
    error_message = "token-broker must NOT receive the broker_skip sidecar."
  }
}

run "other_service_skips_targeted" {
  command = plan
  variables { service_name = "deposits-api" }
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.this.container_definitions)) == 3
    error_message = "deposits-api must receive 1 main + universal + broker_skip = 3 containers."
  }
  assert {
    condition     = !anytrue([for c in jsondecode(aws_ecs_task_definition.this.container_definitions) : c.name == "targeted"])
    error_message = "deposits-api must NOT receive the targeted sidecar."
  }
}
