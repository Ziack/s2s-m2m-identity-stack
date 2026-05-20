import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ExampleServicesStack } from '../lib/example-services-stack';

const props = {
  env: { account: '111111111111', region: 'us-east-1' },
  kmsCmkArn: 'arn:aws:kms:us-east-1:111111111111:key/abc',
  imageTag: 'def5678',
  vpcId: 'vpc-1234',
  privateSubnetIds: ['subnet-a', 'subnet-b'],
  workloadSecurityGroupId: 'sg-1',
  cognitoDomain: 'd.auth.us-east-1.amazoncognito.com',
  lendingClientId: 'lending-client-id',
  lendingClientSecretArn: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:s-AAAAAA',
  redisEndpoint: 'redis.local:6379',
  avpLendingPolicyStoreId: 'ps-1',
};

describe('ExampleServicesStack — receiving service (15d)', () => {
  const stack = new ExampleServicesStack(new App(), 'ExSvcRecv', props);
  const template = Template.fromStack(stack);

  it('creates the receiving task definition with read-only root filesystem and imageTag', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          ReadonlyRootFilesystem: true,
          Image: { 'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp(':def5678')])]) },
        }),
      ]),
    });
  });

  it('wires EXPECTED_AUDIENCE and RESOURCE_PREFIX env vars', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            { Name: 'EXPECTED_AUDIENCE', Value: 'lending' },
            { Name: 'RESOURCE_PREFIX', Value: 'lending' },
          ]),
        }),
      ]),
    });
  });

  it('creates a dedicated log group at /s2s/receiving-service with 30-day retention', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/s2s/receiving-service', RetentionInDays: 30,
    });
  });

  it('creates 2 ECS Fargate services in total (calling + receiving)', () => {
    template.resourceCountIs('AWS::ECS::Service', 2);
  });
});
