import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ExampleServicesStack } from '../lib/example-services-stack';

const props = {
  env: { account: '111111111111', region: 'us-east-1' },
  kmsCmkArn: 'arn:aws:kms:us-east-1:111111111111:key/abc',
  imageTag: 'initial',
  vpcId: 'vpc-1234',
  privateSubnetIds: ['subnet-a', 'subnet-b'],
  workloadSecurityGroupId: 'sg-1',
  cognitoDomain: 'd', lendingClientId: 'c',
  lendingClientSecretArn: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:s-AAAAAA',
  redisEndpoint: 'r', avpLendingPolicyStoreId: 'ps',
};

describe('ExampleServicesStack — ALB (15e)', () => {
  const stack = new ExampleServicesStack(new App(), 'ExSvcAlb', props);
  const template = Template.fromStack(stack);

  it('creates one internal Application Load Balancer', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internal', Type: 'application',
    });
  });

  it('creates two target groups with /health health checks', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 2);
    template.allResources('AWS::ElasticLoadBalancingV2::TargetGroup', Match.objectLike({
      Properties: Match.objectLike({ HealthCheckPath: '/health' }),
    }));
  });

  it('exports AlbDnsName for cross-stack consumers', () => {
    const outputs = template.findOutputs('*');
    expect(outputs['AlbDnsName']).toBeDefined();
  });
});
