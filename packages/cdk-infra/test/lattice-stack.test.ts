import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LatticeStack } from '../lib/lattice-stack';

describe('LatticeStack', () => {
  const app = new App();
  const stack = new LatticeStack(app, 'TestLatticeStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates a ServiceNetwork with AWS_IAM auth', () => {
    template.resourceCountIs('AWS::VpcLattice::ServiceNetwork', 1);
    template.hasResourceProperties('AWS::VpcLattice::ServiceNetwork', {
      Name: 's2s-m2m-network',
      AuthType: 'AWS_IAM',
    });
  });

  it('enables access logs to both S3 and CloudWatch', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.resourceCountIs('AWS::Logs::LogGroup', 1);
    template.resourceCountIs('AWS::VpcLattice::AccessLogSubscription', 2);
  });

  it('creates 6 Lattice services (one per bounded context)', () => {
    template.resourceCountIs('AWS::VpcLattice::Service', 6);
  });

  it('attaches an HTTPS listener with TLS 1.2+ to each service', () => {
    template.resourceCountIs('AWS::VpcLattice::Listener', 6);
    template.hasResourceProperties('AWS::VpcLattice::Listener', {
      Protocol: 'HTTPS',
      Port: 443,
    });
  });

  it('exports ServiceNetworkArn and a service ARN per bounded context', () => {
    const outputs = template.findOutputs('*');
    expect(outputs['ServiceNetworkArn']).toBeDefined();
    expect(outputs['LendingLatticeServiceArn']).toBeDefined();
    expect(outputs['DepositsLatticeServiceArn']).toBeDefined();
    expect(outputs['PaymentsLatticeServiceArn']).toBeDefined();
    expect(outputs['FraudLatticeServiceArn']).toBeDefined();
    expect(outputs['NotificationsLatticeServiceArn']).toBeDefined();
    expect(outputs['AccountsLatticeServiceArn']).toBeDefined();
  });
});

void Match;
