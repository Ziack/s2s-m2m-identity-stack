import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { HybridBrokerStack } from '../lib/hybrid-broker-stack';

describe('HybridBrokerStack', () => {
  const app = new App();
  const stack = new HybridBrokerStack(app, 'TestHybridBrokerStack', {
    env: { account: '111111111111', region: 'us-east-1' },
    onPremCidr: '10.50.0.0/16',
    customerVpnGatewayIp: '203.0.113.10',
    customerBgpAsn: 65000,
  });
  const template = Template.fromStack(stack);

  it('creates a dedicated Network Hub VPC across 3 AZs', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.hasResourceProperties('AWS::EC2::VPC', {
      EnableDnsHostnames: true, EnableDnsSupport: true,
    });
  });

  it('creates a Site-to-Site VPN (VGW + Customer Gateway + Connection)', () => {
    template.resourceCountIs('AWS::EC2::VPNGateway', 1);
    template.resourceCountIs('AWS::EC2::CustomerGateway', 1);
    template.resourceCountIs('AWS::EC2::VPNConnection', 1);
    template.hasResourceProperties('AWS::EC2::CustomerGateway', {
      IpAddress: '203.0.113.10', BgpAsn: 65000,
    });
  });

  it('creates an ECS cluster with a Fargate service of min 2 desired tasks', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.resourceCountIs('AWS::ECS::Service', 1);
    template.hasResourceProperties('AWS::ECS::Service', {
      LaunchType: 'FARGATE',
      DesiredCount: 2,
    });
  });

  it('configures application autoscaling target with min 2 and max 10', () => {
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 1);
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 2, MaxCapacity: 10,
    });
  });

  it('creates a DynamoDB mapping table on-prem identity → client_id → scopes', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 's2s-m2m-hybrid-mapping',
      KeySchema: Match.arrayWith([
        Match.objectLike({ AttributeName: 'on_prem_id', KeyType: 'HASH' }),
      ]),
      SSESpecification: Match.objectLike({ SSEEnabled: true }),
    });
  });

  it('creates a CloudWatch log group for translation logging', () => {
    template.resourceCountIs('AWS::Logs::LogGroup', 1);
  });

  it('exports BrokerAlbDnsName and MappingTableArn', () => {
    const outputs = template.findOutputs('*');
    expect(outputs['BrokerAlbDnsName']).toBeDefined();
    expect(outputs['MappingTableArn']).toBeDefined();
  });
});
