import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Stack } from 'aws-cdk-lib';
import { EcrStack } from '../lib/ecr-stack';

describe('EcrStack', () => {
  const app = new App();
  const env = { account: '111111111111', region: 'us-east-1' };
  const keyStack = new Stack(app, 'TestKeyStack', { env });
  const cmk = new kms.Key(keyStack, 'TestCmk', { enableKeyRotation: true });
  const stack = new EcrStack(app, 'TestEcrStack', { env, encryptionKey: cmk });
  const template = Template.fromStack(stack);

  it('creates exactly two ECR repositories', () => {
    template.resourceCountIs('AWS::ECR::Repository', 2);
  });

  it('creates the s2s-calling-service and s2s-receiving-service repos with scan-on-push + IMMUTABLE tags + KMS encryption', () => {
    for (const name of ['s2s-calling-service', 's2s-receiving-service']) {
      template.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: name,
        ImageScanningConfiguration: { ScanOnPush: true },
        ImageTagMutability: 'IMMUTABLE',
        EncryptionConfiguration: Match.objectLike({
          EncryptionType: 'KMS',
          KmsKey: Match.anyValue(),
        }),
      });
    }
  });

  it('attaches a lifecycle rule keeping only the last 10 tagged images', () => {
    template.hasResourceProperties('AWS::ECR::Repository', {
      LifecyclePolicy: Match.objectLike({
        LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":\\s*10'),
      }),
    });
  });

  it('retains both repositories on stack deletion', () => {
    template.allResources('AWS::ECR::Repository', Match.objectLike({
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    }));
  });

  it('exports the URI for each repository with stable export names', () => {
    const outputs = template.findOutputs('*');
    expect(outputs['CallingRepoUri']).toBeDefined();
    expect(outputs['CallingRepoUri'].Export?.Name).toBe('EcrStack-Calling-Uri');
    expect(outputs['ReceivingRepoUri']).toBeDefined();
    expect(outputs['ReceivingRepoUri'].Export?.Name).toBe('EcrStack-Receiving-Uri');
  });
});
