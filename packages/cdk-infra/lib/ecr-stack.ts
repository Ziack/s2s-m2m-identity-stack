import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface EcrStackProps extends StackProps {
  readonly encryptionKey: kms.IKey;
}

export class EcrStack extends Stack {
  public readonly callingRepo: ecr.Repository;
  public readonly receivingRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrStackProps) {
    super(scope, id, props);

    const repoProps = (name: string): ecr.RepositoryProps => ({
      repositoryName: name,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.KMS,
      encryptionKey: props.encryptionKey,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep only the last 10 tagged images',
          maxImageCount: 10,
          rulePriority: 1,
          tagStatus: ecr.TagStatus.TAGGED,
          tagPatternList: ['*'],
        },
      ],
    });

    this.callingRepo = new ecr.Repository(this, 'CallingRepo', repoProps('s2s-calling-service'));
    this.receivingRepo = new ecr.Repository(this, 'ReceivingRepo', repoProps('s2s-receiving-service'));

    new CfnOutput(this, 'CallingRepoUri', {
      value: this.callingRepo.repositoryUri,
      exportName: 'EcrStack-Calling-Uri',
    });
    new CfnOutput(this, 'ReceivingRepoUri', {
      value: this.receivingRepo.repositoryUri,
      exportName: 'EcrStack-Receiving-Uri',
    });

    void Duration.seconds(0);
  }
}
