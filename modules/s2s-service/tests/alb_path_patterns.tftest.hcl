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
  service_name               = "calling-service"
  bounded_context            = "lending"
  scopes                     = ["lending/write"]
  image_uri                  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/dev/calling-service:latest"
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
    sidecars                   = []
    sidecar_iam_statements     = []
    sidecar_volumes            = []
  }
}

# --- Positive: list form (multi-path) ------------------------------------

run "list_form_emits_all_path_patterns" {
  command = plan

  variables {
    alb_path_patterns = ["/auth/*", "/demo/*", "/health", "/metrics"]
  }

  assert {
    condition = length(setintersection(
      toset(flatten([for c in aws_lb_listener_rule.this.condition : [for p in c.path_pattern : p.values]])),
      toset(["/auth/*", "/demo/*", "/health", "/metrics"]),
    )) == 4
    error_message = "Listener rule must OR all four supplied path patterns into a single rule."
  }
  assert {
    condition     = length(flatten([for c in aws_lb_listener_rule.this.condition : [for p in c.path_pattern : p.values]])) == 4
    error_message = "Listener rule must contain exactly the four supplied path patterns."
  }
  # service_url is derived from the first effective pattern.
  assert {
    condition     = output.service_url == "https://fake-alb.internal/auth"
    error_message = "service_url should derive from the first effective path pattern."
  }
}

# --- Positive: string form (backward compatibility) ----------------------

run "string_form_still_works" {
  command = plan

  variables {
    alb_path_pattern = "/api/loans*"
  }

  assert {
    condition     = toset(flatten([for c in aws_lb_listener_rule.this.condition : [for p in c.path_pattern : p.values]])) == toset(["/api/loans*"])
    error_message = "Single-string alb_path_pattern must still produce a one-value listener rule."
  }
}

# --- Negative: neither set fails validation ------------------------------

run "neither_set_fails" {
  command = plan

  variables {
    alb_path_pattern  = null
    alb_path_patterns = null
  }

  expect_failures = [
    var.alb_path_patterns,
  ]
}

# --- Negative: both set fails validation ---------------------------------

run "both_set_fails" {
  command = plan

  variables {
    alb_path_pattern  = "/auth/*"
    alb_path_patterns = ["/auth/*", "/demo/*"]
  }

  expect_failures = [
    var.alb_path_patterns,
  ]
}
