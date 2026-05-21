data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name_prefix}-exec"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ReadOwnClientSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.client_secret.arn]
  }

  statement {
    sid       = "DecryptPlatformSecretsCmk"
    actions   = ["kms:Decrypt"]
    resources = [var.platform.kms_secrets_key_arn]
  }

  statement {
    sid       = "AvpAuthorize"
    actions   = ["verifiedpermissions:IsAuthorizedWithToken", "verifiedpermissions:IsAuthorized"]
    resources = ["arn:aws:verifiedpermissions::${var.platform.account_id}:policy-store/${var.platform.policy_store_id}"]
  }

  # Same secret as inbound — per spec §4 decision #10, the broker validates
  # actor credentials directly against Cognito via client_credentials.
  # No separate outbound-actor secret is needed.
  dynamic "statement" {
    for_each = length(var.outbound_audiences) > 0 ? [1] : []
    content {
      sid       = "ReadOwnActorSecret"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [aws_secretsmanager_secret.client_secret.arn]
    }
  }

  # Outbound SigV4-signed Lattice calls. The task role needs
  # vpc-lattice-svcs:Invoke to call the broker (token exchange) and any
  # downstream Lattice services in outbound_audiences.
  #
  # Ideally scoped to the exact Lattice service ARNs of the audiences, but those
  # ARNs belong to OTHER s2s-service instances / the platform broker and aren't
  # available at plan time (cross-instance reference). Pragmatic scope: all
  # Lattice services in THIS account. TIGHTENING PATH: once callees publish their
  # lattice_service_arn output, the consumer can replace the wildcard with the
  # specific ARNs. Gated so a service that neither calls the broker nor any
  # audience gets no statement at all.
  dynamic "statement" {
    for_each = (var.calls_broker || length(var.outbound_audiences) > 0) ? [1] : []
    content {
      sid       = "InvokeLatticeServices"
      actions   = ["vpc-lattice-svcs:Invoke"]
      resources = ["arn:aws:vpc-lattice:${var.platform.region}:${var.platform.account_id}:service/*"]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# Sidecar IAM statements merged into the task role only when applicable.
resource "aws_iam_role_policy" "platform_sidecar_permissions" {
  count = length(local.applicable_iam_statements) > 0 ? 1 : 0
  name  = "platform-sidecar-perms"
  role  = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      for s in local.applicable_iam_statements : {
        Effect   = s.effect
        Action   = s.actions
        Resource = s.resources
      }
    ]
  })
}
