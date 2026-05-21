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

  dynamic "statement" {
    for_each = length(var.outbound_audiences) > 0 ? [1] : []
    content {
      sid       = "ReadOwnActorSecret"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [aws_secretsmanager_secret.client_secret.arn]
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
