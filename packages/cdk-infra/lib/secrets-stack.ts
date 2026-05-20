import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { BOUNDED_CONTEXTS, BoundedContext, pascal } from './shared/bounded-contexts';

export interface SecretsStackProps extends StackProps {
  readonly userPool: cognito.IUserPool;
  readonly clientsByContext: Record<BoundedContext, cognito.IUserPoolClient>;
  /** ARNs of ECS task roles / EKS pod roles permitted to read secrets. */
  readonly taskRoleArns: string[];
}

export class SecretsStack extends Stack {
  public readonly secretsKey: kms.Key;
  public readonly secretsByContext: Record<BoundedContext, secretsmanager.Secret>;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    this.secretsKey = new kms.Key(this, 'M2MSecretsKey', {
      alias: 'alias/s2s-m2m-secrets',
      description: 'CMK encrypting M2M client_secrets in Secrets Manager',
      enableKeyRotation: true,
      keySpec: kms.KeySpec.SYMMETRIC_DEFAULT,
      keyUsage: kms.KeyUsage.ENCRYPT_DECRYPT,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const rotationLambda = new lambda.Function(this, 'RotationFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'secrets-rotation')),
      timeout: Duration.minutes(5),
      memorySize: 256,
      description: 'M2M client_secret rotation: createSecret -> setSecret -> testSecret -> finishSecret',
    });
    rotationLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:DescribeUserPoolClient',
        'cognito-idp:UpdateUserPoolClient',
      ],
      resources: [props.userPool.userPoolArn],
    }));
    this.secretsKey.grantEncryptDecrypt(rotationLambda);

    const secrets = {} as Record<BoundedContext, secretsmanager.Secret>;
    for (const ctx of BOUNDED_CONTEXTS) {
      const client = props.clientsByContext[ctx];
      const secret = new secretsmanager.Secret(this, `${pascal(ctx)}Secret`, {
        secretName: `m2m/${ctx}/client-secret`,
        description: `Cognito M2M client_secret for ${ctx} service`,
        encryptionKey: this.secretsKey,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            user_pool_id: props.userPool.userPoolId,
            client_id: client.userPoolClientId,
          }),
          generateStringKey: 'client_secret',
          excludePunctuation: true,
          passwordLength: 64,
        },
        removalPolicy: RemovalPolicy.RETAIN,
      });

      secret.addRotationSchedule(`${pascal(ctx)}RotationSchedule`, {
        rotationLambda,
        automaticallyAfter: Duration.days(90),
      });

      secret.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'DenyAllExceptTaskRoles',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'],
        conditions: {
          StringNotEquals: { 'aws:PrincipalArn': props.taskRoleArns },
        },
      }));

      rotationLambda.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:UpdateSecretVersionStage',
        ],
        resources: [secret.secretArn],
      }));

      new CfnOutput(this, `${pascal(ctx)}SecretArn`, {
        value: secret.secretArn,
        exportName: `${this.stackName}-${pascal(ctx)}SecretArn`,
      });
      secrets[ctx] = secret;
    }
    this.secretsByContext = secrets;

    new CfnOutput(this, 'SecretsKmsKeyArn', {
      value: this.secretsKey.keyArn,
      exportName: `${this.stackName}-SecretsKmsKeyArn`,
    });
  }
}
