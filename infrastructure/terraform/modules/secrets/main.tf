resource "aws_kms_key" "secrets" {
  description              = "CMK encrypting M2M client_secrets in Secrets Manager"
  key_usage                = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  enable_key_rotation      = true
  deletion_window_in_days  = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/s2s-m2m-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

# --- Rotation Lambda ---------------------------------------------------------

data "archive_file" "rotation_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rotation" {
  name_prefix        = "s2s-m2m-rotation-"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "rotation_basic" {
  role       = aws_iam_role.rotation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "rotation_inline" {
  statement {
    sid = "CognitoClientManage"
    actions = [
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:UpdateUserPoolClient",
    ]
    resources = [var.user_pool_arn]
  }

  statement {
    sid = "SecretsManagerRotation"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecretVersionStage",
    ]
    resources = [for s in aws_secretsmanager_secret.context : s.arn]
  }

  statement {
    sid = "KmsForSecrets"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.secrets.arn]
  }
}

resource "aws_iam_role_policy" "rotation_inline" {
  name   = "rotation-inline"
  role   = aws_iam_role.rotation.id
  policy = data.aws_iam_policy_document.rotation_inline.json
}

resource "aws_lambda_function" "rotation" {
  function_name    = "s2s-m2m-secret-rotation"
  role             = aws_iam_role.rotation.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.rotation_lambda.output_path
  source_code_hash = data.archive_file.rotation_lambda.output_base64sha256
  timeout          = 300
  memory_size      = 256
  description      = "M2M client_secret rotation: createSecret -> setSecret -> testSecret -> finishSecret"
}

resource "aws_lambda_permission" "secrets_manager" {
  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
}

# --- One Secret per bounded context -----------------------------------------

resource "aws_secretsmanager_secret" "context" {
  for_each = toset(var.bounded_contexts)

  name        = "m2m/${each.key}/client-secret"
  description = "Cognito M2M client_secret for ${each.key} service"
  kms_key_id  = aws_kms_key.secrets.arn

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret_version" "context_seed" {
  for_each = toset(var.bounded_contexts)

  secret_id = aws_secretsmanager_secret.context[each.key].id
  secret_string = jsonencode({
    user_pool_id  = var.user_pool_id
    client_id     = var.client_ids[each.key]
    client_secret = "PENDING_BOOTSTRAP"
  })
}

data "aws_iam_policy_document" "deny_except_task_roles" {
  for_each = toset(var.bounded_contexts)

  statement {
    sid     = "DenyAllExceptTaskRoles"
    effect  = "Deny"
    actions = ["secretsmanager:GetSecretValue"]
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    resources = ["*"]
    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalArn"
      values   = var.task_role_arns
    }
  }
}

resource "aws_secretsmanager_secret_policy" "context" {
  for_each = toset(var.bounded_contexts)

  secret_arn = aws_secretsmanager_secret.context[each.key].arn
  policy     = data.aws_iam_policy_document.deny_except_task_roles[each.key].json
}

resource "aws_secretsmanager_secret_rotation" "context" {
  for_each = toset(var.bounded_contexts)

  secret_id           = aws_secretsmanager_secret.context[each.key].id
  rotation_lambda_arn = aws_lambda_function.rotation.arn

  rotation_rules {
    automatically_after_days = 90
  }

  depends_on = [
    aws_lambda_permission.secrets_manager,
    aws_iam_role_policy.rotation_inline,
    aws_secretsmanager_secret_version.context_seed,
  ]
}
