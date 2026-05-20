import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ExampleServicesStack } from '../lib/example-services-stack';

const props = {
  env: { account: '111111111111', region: 'us-east-1' },
  kmsCmkArn: 'arn:aws:kms:us-east-1:111111111111:key/abc',
  imageTag: 'abc1234',
  vpcId: 'vpc-1234',
  privateSubnetIds: ['subnet-a', 'subnet-b'],
  workloadSecurityGroupId: 'sg-1',
  cognitoDomain: 'd.auth.us-east-1.amazoncognito.com',
  lendingClientId: 'lending-client-id',
  lendingClientSecretArn: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:s-AAAAAA',
  redisEndpoint: 'redis.local:6379',
  avpLendingPolicyStoreId: 'ps-1',
};

describe('ExampleServicesStack — calling service (15c)', () => {
  const stack = new ExampleServicesStack(new App(), 'ExSvcCalling', props);
  const template = Template.fromStack(stack);

  it('creates a Fargate task definition for the calling service with read-only root filesystem and imageTag from props', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          ReadonlyRootFilesystem: true,
          // CDK renders ECR image as Fn::Join token (account+region+repo+tag).
          // We assert the join array contains the imageTag literal.
          Image: { 'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp(':abc1234')])]) },
        }),
      ]),
    });
  });

  it('wires environment variables from CDK props (no hardcoded URLs/IDs)', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            { Name: 'COGNITO_CLIENT_ID', Value: 'lending-client-id' },
            { Name: 'COGNITO_DOMAIN', Value: 'd.auth.us-east-1.amazoncognito.com' },
            { Name: 'AVP_POLICY_STORE_ID', Value: 'ps-1' },
          ]),
        }),
      ]),
    });
  });

  it('creates an ECS Fargate service for the calling service with desiredCount=2 and assignPublicIp=false', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: 2,
      LaunchType: 'FARGATE',
      NetworkConfiguration: Match.objectLike({
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'DISABLED' }),
      }),
    });
  });

  it('creates a dedicated log group at /s2s/calling-service with 30-day retention', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/s2s/calling-service', RetentionInDays: 30,
    });
  });
});
