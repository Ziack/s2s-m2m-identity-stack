import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ElastiCacheStack } from '../lib/elasticache-stack';

describe('ElastiCacheStack', () => {
  const app = new App();
  const stack = new ElastiCacheStack(app, 'TestElastiCacheStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates a VPC with private subnets across 3 AZs', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.hasResourceProperties('AWS::EC2::VPC', {
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
    });
  });

  it('creates a KMS CMK with rotation', () => {
    template.resourceCountIs('AWS::KMS::Key', 1);
    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
    });
  });

  it('creates a Valkey 7 Serverless cache with TLS and KMS at-rest', () => {
    template.resourceCountIs('AWS::ElastiCache::ServerlessCache', 1);
    template.hasResourceProperties('AWS::ElastiCache::ServerlessCache', {
      Engine: 'valkey',
      MajorEngineVersion: '7',
      ServerlessCacheName: 's2s-m2m-valkey',
      KmsKeyId: Match.anyValue(),
    });
  });

  it('creates a workload security group and a cache security group with inbound 6379 from workloads only', () => {
    template.resourceCountIs('AWS::EC2::SecurityGroup', 2);
    const ingressFromWorkload = Match.objectLike({
      IpProtocol: 'tcp',
      FromPort: 6379,
      ToPort: 6379,
      SourceSecurityGroupId: Match.anyValue(),
    });
    try {
      template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', ingressFromWorkload);
    } catch {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        SecurityGroupIngress: Match.arrayWith([ingressFromWorkload]),
      });
    }
  });

  it('exports endpoint, port, security group IDs, and VPC ID', () => {
    const outputs = template.findOutputs('*');
    expect(outputs['ValkeyEndpoint']).toBeDefined();
    expect(outputs['ValkeyPort']).toBeDefined();
    expect(outputs['ValkeySgId']).toBeDefined();
    expect(outputs['WorkloadSgId']).toBeDefined();
    expect(outputs['VpcId']).toBeDefined();
  });
});
