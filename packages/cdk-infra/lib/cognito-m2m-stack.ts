import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { BOUNDED_CONTEXTS, BoundedContext, SCOPES_PER_CONTEXT, pascal } from './shared/bounded-contexts';

export interface CognitoM2MStackProps extends StackProps {}

export class CognitoM2MStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly clientsByContext: Record<BoundedContext, cognito.UserPoolClient>;
  public readonly batchClient!: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: CognitoM2MStackProps = {}) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'M2MPool', {
      userPoolName: 's2s-m2m-identity',
      selfSignUpEnabled: false,
      signInAliases: {},
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.userPool.addDomain('M2MDomain', {
      cognitoDomain: { domainPrefix: 's2s-m2m' },
    });

    const clients = {} as Record<BoundedContext, cognito.UserPoolClient>;
    const resourceServers = {} as Record<BoundedContext, cognito.UserPoolResourceServer>;

    for (const ctx of BOUNDED_CONTEXTS) {
      const rs = this.userPool.addResourceServer(`${pascal(ctx)}ResourceServer`, {
        identifier: ctx,
        userPoolResourceServerName: ctx,
        scopes: SCOPES_PER_CONTEXT[ctx].map((s) => ({
          scopeName: s.name,
          scopeDescription: s.description,
        })),
      });

      const client = this.userPool.addClient(`${pascal(ctx)}ServiceClient`, {
        userPoolClientName: `${ctx}-service`,
        generateSecret: true,
        accessTokenValidity: Duration.minutes(5),
        enableTokenRevocation: true,
        authFlows: {},
        oAuth: {
          flows: { clientCredentials: true },
          scopes: SCOPES_PER_CONTEXT[ctx].map((s) =>
            cognito.OAuthScope.resourceServer(rs, { scopeName: s.name, scopeDescription: s.description }),
          ),
        },
      });
      client.node.addDependency(rs);
      clients[ctx] = client;
      resourceServers[ctx] = rs;

      new CfnOutput(this, `${pascal(ctx)}ClientId`, {
        value: client.userPoolClientId,
        exportName: `${this.stackName}-${pascal(ctx)}ClientId`,
      });
    }
    this.clientsByContext = clients;

    const lendingRs = resourceServers['lending'];
    const batchClient = this.userPool.addClient('BatchProcessorClient', {
      userPoolClientName: 'batch-processor',
      generateSecret: true,
      accessTokenValidity: Duration.minutes(5),
      enableTokenRevocation: true,
      authFlows: {},
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [
          cognito.OAuthScope.resourceServer(lendingRs, { scopeName: 'read',  scopeDescription: 'Read lending resources'  }),
          cognito.OAuthScope.resourceServer(lendingRs, { scopeName: 'write', scopeDescription: 'Write lending resources' }),
        ],
      },
    });
    batchClient.node.addDependency(lendingRs);
    this.batchClient = batchClient;

    new CfnOutput(this, 'BatchClientId', {
      value: batchClient.userPoolClientId,
      exportName: `${this.stackName}-BatchClientId`,
    });

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${this.stackName}-UserPoolId`,
    });
    new CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      exportName: `${this.stackName}-UserPoolArn`,
    });
    new CfnOutput(this, 'DomainName', {
      value: 's2s-m2m',
      exportName: `${this.stackName}-DomainName`,
    });
  }

  /**
   * Copy each Cognito-generated client_secret into the matching Secrets Manager
   * entry. Called from bin/app.ts AFTER SecretsStack is constructed.
   */
  public attachSecretBootstrap(
    secretsByContext: Record<BoundedContext, secretsmanager.ISecret>,
  ): void {
    // Sever the cross-stack token dependency that would otherwise cycle with the
    // SecretsStack -> CognitoM2MStack (UserPool ARN) ref. We reconstruct the secret
    // ARN deterministically from the well-known SM name `m2m/<ctx>/client-secret`
    // (see SecretsStack.ts) so this stack does NOT consume tokens from SecretsStack.
    void secretsByContext;
    for (const ctx of BOUNDED_CONTEXTS) {
      const client = this.clientsByContext[ctx];
      // Wildcard suffix because SM appends a random 6-char suffix to ARNs.
      const secretArnWildcard = Stack.of(this).formatArn({
        service: 'secretsmanager',
        resource: 'secret',
        resourceName: `m2m/${ctx}/client-secret-*`,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      });
      const secretArnForPut = Stack.of(this).formatArn({
        service: 'secretsmanager',
        resource: 'secret',
        resourceName: `m2m/${ctx}/client-secret`,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      });

      const describeCr = new AwsCustomResource(this, `${pascal(ctx)}SecretBootstrap`, {
        resourceType: 'Custom::CognitoSecretBootstrap',
        onCreate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'describeUserPoolClient',
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            ClientId: client.userPoolClientId,
          },
          physicalResourceId: PhysicalResourceId.of(`${client.userPoolClientId}-secret-bootstrap`),
        },
        onUpdate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'describeUserPoolClient',
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            ClientId: client.userPoolClientId,
          },
          physicalResourceId: PhysicalResourceId.of(`${client.userPoolClientId}-secret-bootstrap`),
        },
        policy: AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['cognito-idp:DescribeUserPoolClient'],
            resources: [this.userPool.userPoolArn],
          }),
        ]),
      });

      new AwsCustomResource(this, `${pascal(ctx)}SecretPut`, {
        resourceType: 'Custom::CognitoSecretPut',
        onCreate: {
          service: 'SecretsManager',
          action: 'putSecretValue',
          parameters: {
            SecretId: secretArnForPut,
            SecretString: JSON.stringify({
              user_pool_id: this.userPool.userPoolId,
              client_id: client.userPoolClientId,
              client_secret: describeCr.getResponseField('UserPoolClient.ClientSecret'),
            }),
          },
          physicalResourceId: PhysicalResourceId.of(`${client.userPoolClientId}-secret-put`),
        },
        onUpdate: {
          service: 'SecretsManager',
          action: 'putSecretValue',
          parameters: {
            SecretId: secretArnForPut,
            SecretString: JSON.stringify({
              user_pool_id: this.userPool.userPoolId,
              client_id: client.userPoolClientId,
              client_secret: describeCr.getResponseField('UserPoolClient.ClientSecret'),
            }),
          },
          physicalResourceId: PhysicalResourceId.of(`${client.userPoolClientId}-secret-put`),
        },
        policy: AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['secretsmanager:PutSecretValue'],
            resources: [secretArnWildcard],
          }),
        ]),
      });
    }
  }
}
