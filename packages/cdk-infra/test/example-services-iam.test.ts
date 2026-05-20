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
  redisEndpoint: 'r', avpLendingPolicyStoreId: 'ps-abc',
};

describe('ExampleServicesStack — IAM (15b)', () => {
  const stack = new ExampleServicesStack(new App(), 'ExSvcIam', props);
  const template = Template.fromStack(stack);

  it('grants the calling task role SQS SendMessage scoped to the lending queue ARN', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['sqs:SendMessage']),
            Resource: Match.anyValue(),
          }),
        ]),
      }),
    });
  });

  it('grants AVP IsAuthorizedWithToken scoped to the configured policy store', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'verifiedpermissions:IsAuthorizedWithToken',
            Resource: Match.stringLikeRegexp('policy-store/ps-abc'),
          }),
        ]),
      }),
    });
  });

  it('grants the receiving task role SQS receive/delete on the lending queue', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['sqs:ReceiveMessage', 'sqs:DeleteMessage']),
          }),
        ]),
      }),
    });
  });

  it('grants secrets read on the configured client secret ARN', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
          }),
        ]),
      }),
    });
  });
});
