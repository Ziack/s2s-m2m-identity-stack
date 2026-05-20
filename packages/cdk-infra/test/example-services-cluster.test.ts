import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ExampleServicesStack } from '../lib/example-services-stack';

const props = {
  env: { account: '111111111111', region: 'us-east-1' },
  kmsCmkArn: 'arn:aws:kms:us-east-1:111111111111:key/abc',
  imageTag: 'initial',
  vpcId: 'vpc-1234',
  privateSubnetIds: ['subnet-a', 'subnet-b'],
  workloadSecurityGroupId: 'sg-1',
  cognitoDomain: 'd', lendingClientId: 'c', lendingClientSecretArn: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:s-AAAAAA',
  redisEndpoint: 'r', avpLendingPolicyStoreId: 'ps',
};

describe('ExampleServicesStack — cluster (15a)', () => {
  const stack = new ExampleServicesStack(new App(), 'ExSvc', props);
  const template = Template.fromStack(stack);

  it('creates one ECS cluster named s2s-s2s-poc with Container Insights enabled', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterName: 's2s-s2s-poc',
      ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }],
    });
  });

  it('creates a cluster-level log group at /s2s/cluster with 30-day retention', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/s2s/cluster',
      RetentionInDays: 30,
    });
  });
});
