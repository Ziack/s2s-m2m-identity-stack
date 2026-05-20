import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CognitoM2MStack } from '../lib/cognito-m2m-stack';
import { AvpCedarStack } from '../lib/avp-cedar-stack';

describe('AvpCedarStack', () => {
  const app = new App();
  const env = { account: '111111111111', region: 'us-east-1' };
  const cognitoStack = new CognitoM2MStack(app, 'TestCognitoStack2', { env });
  const stack = new AvpCedarStack(app, 'TestAvpCedarStack', {
    env, userPool: cognitoStack.userPool,
  });
  const template = Template.fromStack(stack);

  it('creates exactly 6 PolicyStores, all with STRICT validation', () => {
    template.resourceCountIs('AWS::VerifiedPermissions::PolicyStore', 6);
    template.hasResourceProperties('AWS::VerifiedPermissions::PolicyStore', {
      ValidationSettings: { Mode: 'STRICT' },
    });
  });

  it('creates 6 IdentitySources bound to the Cognito UserPool with ServicePrincipal type', () => {
    template.resourceCountIs('AWS::VerifiedPermissions::IdentitySource', 6);
    template.hasResourceProperties('AWS::VerifiedPermissions::IdentitySource', {
      PrincipalEntityType: 'ServicePrincipal',
      Configuration: Match.objectLike({
        CognitoUserPoolConfiguration: Match.objectLike({
          UserPoolArn: Match.anyValue(),
        }),
      }),
    });
  });

  it('creates at least one seed Cedar Policy per bounded context (6 minimum)', () => {
    template.resourceCountIs('AWS::VerifiedPermissions::Policy', 6);
    template.hasResourceProperties('AWS::VerifiedPermissions::Policy', {
      Definition: Match.objectLike({
        Static: Match.objectLike({ Statement: Match.stringLikeRegexp('permit') }),
      }),
    });
  });

  it('exports a PolicyStoreId per bounded context', () => {
    const outputs = template.findOutputs('*');
    expect(outputs['LendingPolicyStoreId']).toBeDefined();
    expect(outputs['DepositsPolicyStoreId']).toBeDefined();
    expect(outputs['PaymentsPolicyStoreId']).toBeDefined();
    expect(outputs['FraudPolicyStoreId']).toBeDefined();
    expect(outputs['NotificationsPolicyStoreId']).toBeDefined();
    expect(outputs['AccountsPolicyStoreId']).toBeDefined();
  });
});
