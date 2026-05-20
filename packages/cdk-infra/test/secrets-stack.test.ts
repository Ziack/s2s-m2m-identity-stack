import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CognitoM2MStack } from '../lib/cognito-m2m-stack';
import { SecretsStack } from '../lib/secrets-stack';

describe('SecretsStack', () => {
  const app = new App();
  const env = { account: '111111111111', region: 'us-east-1' };
  const cognitoStack = new CognitoM2MStack(app, 'TestCognitoStack', { env });
  const stack = new SecretsStack(app, 'TestSecretsStack', {
    env,
    userPool: cognitoStack.userPool,
    clientsByContext: cognitoStack.clientsByContext,
    taskRoleArns: ['arn:aws:iam::111111111111:role/test-task-role'],
  });
  const template = Template.fromStack(stack);

  it('creates a customer-managed KMS CMK with rotation enabled', () => {
    template.resourceCountIs('AWS::KMS::Key', 1);
    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
      KeySpec: 'SYMMETRIC_DEFAULT',
      KeyUsage: 'ENCRYPT_DECRYPT',
    });
  });

  it('creates 6 Secrets, one per bounded context, named m2m/<service>/client-secret', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 6);
    for (const ctx of ['lending', 'deposits', 'payments', 'fraud', 'notifications', 'accounts']) {
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: `m2m/${ctx}/client-secret`,
        KmsKeyId: Match.anyValue(),
      });
    }
  });

  it('attaches a resource policy denying * principals except task role ARNs', () => {
    template.resourceCountIs('AWS::SecretsManager::ResourcePolicy', 6);
    template.hasResourceProperties('AWS::SecretsManager::ResourcePolicy', {
      ResourcePolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Principal: { AWS: '*' },
            Action: 'secretsmanager:GetSecretValue',
            Condition: Match.objectLike({
              StringNotEquals: Match.objectLike({
                'aws:PrincipalArn': Match.arrayWith(['arn:aws:iam::111111111111:role/test-task-role']),
              }),
            }),
          }),
        ]),
      }),
    });
  });

  it('creates a rotation Lambda', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs20.x',
    });
  });

  it('attaches RotationSchedule with 90-day cadence to every secret', () => {
    template.resourceCountIs('AWS::SecretsManager::RotationSchedule', 6);
    template.hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
      // Current aws-cdk-lib emits ScheduleExpression rather than AutomaticallyAfterDays
      RotationRules: { ScheduleExpression: 'rate(90 days)' },
    });
  });

  it('exports a SecretArn per bounded context and the KMS key ARN', () => {
    const outputs = template.findOutputs('*');
    expect(outputs['SecretsKmsKeyArn']).toBeDefined();
    expect(outputs['LendingSecretArn']).toBeDefined();
    expect(outputs['DepositsSecretArn']).toBeDefined();
    expect(outputs['PaymentsSecretArn']).toBeDefined();
    expect(outputs['FraudSecretArn']).toBeDefined();
    expect(outputs['NotificationsSecretArn']).toBeDefined();
    expect(outputs['AccountsSecretArn']).toBeDefined();
  });
});
