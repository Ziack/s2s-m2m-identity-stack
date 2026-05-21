mock_provider "aws" {
  override_data {
    target = data.aws_iam_policy_document.assume
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ecs-tasks.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}"
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
  override_data {
    target = data.aws_iam_policy_document.lattice_infra_assume
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ecs.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}"
    }
  }
  override_data {
    target = data.aws_iam_policy_document.lattice_infra
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"vpc-lattice:RegisterTargets\"],\"Resource\":\"*\"}]}"
    }
  }
  override_data {
    target = data.aws_iam_policy_document.lattice_auth
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":[\"vpc-lattice-svcs:Invoke\"],\"Resource\":\"*\"}]}"
    }
  }
  override_resource {
    target = aws_vpclattice_service.this
    values = {
      arn       = "arn:aws:vpc-lattice:us-east-1:123456789012:service/svc-fake"
      id        = "svc-fake"
      dns_entry = [{ domain_name = "loan-origination-svc-fake.vpc-lattice-svcs.us-east-1.on.aws", hosted_zone_id = "Z01234567ABCDEF" }]
    }
  }
  override_resource {
    target = aws_vpclattice_target_group.this
    values = {
      arn = "arn:aws:vpc-lattice:us-east-1:123456789012:targetgroup/tg-fake"
      id  = "tg-fake"
    }
  }
  override_resource {
    target = aws_iam_role.lattice_infra
    values = {
      arn = "arn:aws:iam::123456789012:role/svc-lt-infra"
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
  cedar_policies             = []
}

# (a) Platform Lattice disabled -> ZERO lattice resources, even with the default
#     register_with_lattice = true.
run "platform_disabled_no_lattice" {
  command = plan

  variables {
    register_with_lattice = true
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

  assert {
    condition     = length(aws_vpclattice_service.this) == 0
    error_message = "No Lattice service when platform.enable_lattice = false."
  }
  assert {
    condition     = length(aws_vpclattice_target_group.this) == 0
    error_message = "No Lattice target group when platform disabled."
  }
  assert {
    condition     = length(aws_vpclattice_listener.this) == 0
    error_message = "No Lattice listener when platform disabled."
  }
  assert {
    condition     = length(aws_vpclattice_service_network_service_association.this) == 0
    error_message = "No Lattice association when platform disabled."
  }
  assert {
    condition     = length(aws_iam_role.lattice_infra) == 0
    error_message = "No Lattice infra role when platform disabled."
  }
  assert {
    condition     = output.lattice_service_dns == null
    error_message = "lattice_service_dns must be null when not registered."
  }
  assert {
    condition     = output.lattice_service_arn == null
    error_message = "lattice_service_arn must be null when not registered."
  }
  # No vpc_lattice_configurations on the ECS service.
  assert {
    condition     = length(aws_ecs_service.this.vpc_lattice_configurations) == 0
    error_message = "ECS service must have no vpc_lattice_configurations when disabled."
  }
}

# (b) Platform enabled + register_with_lattice = true -> full Lattice plane.
run "enabled_full_lattice" {
  command = plan

  variables {
    register_with_lattice = true
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
      enable_lattice             = true
      lattice_service_network_id = "sn-fake-network"
      broker_lattice_dns         = "broker.vpc-lattice-svcs.us-east-1.on.aws"
      sidecars                   = []
      sidecar_iam_statements     = []
      sidecar_volumes            = []
    }
  }

  assert {
    condition     = length(aws_vpclattice_service.this) == 1
    error_message = "Lattice service must exist when enabled + registered."
  }
  assert {
    condition     = aws_vpclattice_service.this[0].auth_type == "AWS_IAM"
    error_message = "Lattice service must use AWS_IAM auth."
  }
  assert {
    condition     = length(aws_vpclattice_target_group.this) == 1
    error_message = "Lattice target group must exist when enabled."
  }
  assert {
    condition     = aws_vpclattice_target_group.this[0].type == "IP"
    error_message = "Lattice target group must be type IP."
  }
  assert {
    condition     = aws_vpclattice_target_group.this[0].config[0].port == 3000
    error_message = "Lattice target group port must equal container_port (3000)."
  }
  assert {
    condition     = length(aws_vpclattice_listener.this) == 1
    error_message = "Lattice listener must exist when enabled."
  }
  assert {
    condition     = aws_vpclattice_listener.this[0].protocol == "HTTP"
    error_message = "Lattice listener must be HTTP."
  }
  assert {
    condition     = length(aws_vpclattice_service_network_service_association.this) == 1
    error_message = "Lattice association must exist when enabled."
  }
  assert {
    condition     = aws_vpclattice_service_network_service_association.this[0].service_network_identifier == "sn-fake-network"
    error_message = "Association must point at the platform service network."
  }
  assert {
    condition     = length(aws_vpclattice_auth_policy.this) == 1
    error_message = "Auth policy must exist when enabled."
  }
  assert {
    condition     = length(aws_iam_role.lattice_infra) == 1
    error_message = "Lattice infra role must exist when enabled."
  }
  # ECS service gets exactly one vpc_lattice_configurations block.
  assert {
    condition     = length(aws_ecs_service.this.vpc_lattice_configurations) == 1
    error_message = "ECS service must have one vpc_lattice_configurations block."
  }
  assert {
    condition     = anytrue([for c in aws_ecs_service.this.vpc_lattice_configurations : c.port_name == "loan-origination-3000"])
    error_message = "vpc_lattice_configurations.port_name must match the named container port mapping."
  }
  # Named port mapping present on the main container.
  assert {
    condition     = jsondecode(aws_ecs_task_definition.this.container_definitions)[0].portMappings[0].name == "loan-origination-3000"
    error_message = "Main container port mapping must be named for Lattice."
  }
}

# (c) Platform enabled but register_with_lattice = false -> opt-out, ZERO lattice.
run "opt_out_no_lattice" {
  command = plan

  variables {
    register_with_lattice = false
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
      enable_lattice             = true
      lattice_service_network_id = "sn-fake-network"
      broker_lattice_dns         = "broker.vpc-lattice-svcs.us-east-1.on.aws"
      sidecars                   = []
      sidecar_iam_statements     = []
      sidecar_volumes            = []
    }
  }

  assert {
    condition     = length(aws_vpclattice_service.this) == 0
    error_message = "No Lattice service when register_with_lattice = false."
  }
  assert {
    condition     = length(aws_vpclattice_target_group.this) == 0
    error_message = "No Lattice target group on opt-out."
  }
  assert {
    condition     = length(aws_vpclattice_listener.this) == 0
    error_message = "No Lattice listener on opt-out."
  }
  assert {
    condition     = length(aws_iam_role.lattice_infra) == 0
    error_message = "No Lattice infra role on opt-out."
  }
  assert {
    condition     = output.lattice_service_dns == null
    error_message = "lattice_service_dns must be null on opt-out."
  }
  assert {
    condition     = length(aws_ecs_service.this.vpc_lattice_configurations) == 0
    error_message = "ECS service must have no vpc_lattice_configurations on opt-out."
  }
}
