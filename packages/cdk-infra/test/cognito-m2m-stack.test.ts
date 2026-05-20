import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { CognitoM2MStack } from '../lib/cognito-m2m-stack';

describe('CognitoM2MStack', () => {
  const app = new App();
  const stack = new CognitoM2MStack(app, 'TestCognitoM2MStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates exactly one UserPool with advanced security ENFORCED and RETAIN', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 's2s-m2m-identity',
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UserPoolAddOns: { AdvancedSecurityMode: 'ENFORCED' },
    });
    template.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('creates 6 ResourceServers, one per bounded context, with read+write scopes', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolResourceServer', 6);
    for (const ctx of ['lending', 'deposits', 'payments', 'fraud', 'notifications', 'accounts']) {
      template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
        Identifier: ctx,
        Name: ctx,
        Scopes: Match.arrayWith([
          Match.objectLike({ ScopeName: 'read' }),
          Match.objectLike({ ScopeName: 'write' }),
        ]),
      });
    }
  });

  it('creates 7 UserPoolClients (6 bounded contexts + 1 batch-processor) with generateSecret + clientCredentials, 5min token, revocation enabled', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 7);
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'batch-processor',
      GenerateSecret: true,
      AllowedOAuthFlows: ['client_credentials'],
      AllowedOAuthScopes: Match.arrayWith([
        { 'Fn::Join': ['', [{ Ref: Match.stringLikeRegexp('.*LendingResourceServer.*') }, '/read']] },
        { 'Fn::Join': ['', [{ Ref: Match.stringLikeRegexp('.*LendingResourceServer.*') }, '/write']] },
      ]),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: true,
      AllowedOAuthFlows: ['client_credentials'],
      AllowedOAuthFlowsUserPoolClient: true,
      AccessTokenValidity: 5,
      TokenValidityUnits: Match.objectLike({ AccessToken: 'minutes' }),
      EnableTokenRevocation: true,
      ExplicitAuthFlows: Match.absent(),
    });
  });

  it('creates a Cognito hosted domain', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 's2s-m2m',
    });
  });

  it('exports UserPoolId, UserPoolArn, a ClientId per bounded context, plus BatchClientId', () => {
    const outputs = template.findOutputs('*');
    expect(outputs['UserPoolId']).toBeDefined();
    expect(outputs['UserPoolArn']).toBeDefined();
    expect(outputs['LendingClientId']).toBeDefined();
    expect(outputs['DepositsClientId']).toBeDefined();
    expect(outputs['PaymentsClientId']).toBeDefined();
    expect(outputs['FraudClientId']).toBeDefined();
    expect(outputs['NotificationsClientId']).toBeDefined();
    expect(outputs['AccountsClientId']).toBeDefined();
    expect(outputs['BatchClientId']).toBeDefined();
  });
});

describe('CognitoM2MStack.attachSecretBootstrap', () => {
  const app = new App();
  const env = { account: '111111111111', region: 'us-east-1' };
  const stack = new CognitoM2MStack(app, 'TestCognitoBootstrapStack', { env });

  const siblingStack = new Stack(app, 'TestSiblingSecretsStack', { env });
  const secretsByContext = Object.fromEntries(
    ['lending', 'deposits', 'payments', 'fraud', 'notifications', 'accounts'].map((ctx) => [
      ctx,
      new secretsmanager.Secret(siblingStack, `${ctx}Secret`, { secretName: `m2m/${ctx}/client-secret` }),
    ]),
  ) as Record<string, secretsmanager.ISecret>;

  stack.attachSecretBootstrap(secretsByContext as any);
  const template = Template.fromStack(stack);

  it('creates one describe + one put custom resource per bounded context (12 total)', () => {
    template.resourceCountIs('Custom::CognitoSecretBootstrap', 6);
    template.resourceCountIs('Custom::CognitoSecretPut', 6);
  });

  it('grants DescribeUserPoolClient on the user pool and PutSecretValue on each secret', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'cognito-idp:DescribeUserPoolClient',
          }),
        ]),
      }),
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'secretsmanager:PutSecretValue',
          }),
        ]),
      }),
    });
  });
});
