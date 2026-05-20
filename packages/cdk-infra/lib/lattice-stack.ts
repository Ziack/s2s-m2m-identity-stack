import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as vpclattice from 'aws-cdk-lib/aws-vpclattice';
import { Construct } from 'constructs';
import { BOUNDED_CONTEXTS, BoundedContext, pascal } from './shared/bounded-contexts';

export interface LatticeStackProps extends StackProps {}

export class LatticeStack extends Stack {
  public readonly serviceNetwork: vpclattice.CfnServiceNetwork;
  public readonly servicesByContext: Record<BoundedContext, vpclattice.CfnService>;

  constructor(scope: Construct, id: string, props: LatticeStackProps = {}) {
    super(scope, id, props);

    this.serviceNetwork = new vpclattice.CfnServiceNetwork(this, 'M2MNetwork', {
      name: 's2s-m2m-network',
      authType: 'AWS_IAM',
    });

    const logsBucket = new s3.Bucket(this, 'LatticeAccessLogsBucket', {
      bucketName: `s2s-m2m-lattice-logs-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const logGroup = new logs.LogGroup(this, 'LatticeAccessLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new vpclattice.CfnAccessLogSubscription(this, 'LatticeLogsS3', {
      resourceIdentifier: this.serviceNetwork.attrArn,
      destinationArn: logsBucket.bucketArn,
    });
    new vpclattice.CfnAccessLogSubscription(this, 'LatticeLogsCw', {
      resourceIdentifier: this.serviceNetwork.attrArn,
      destinationArn: logGroup.logGroupArn,
    });

    const services = {} as Record<BoundedContext, vpclattice.CfnService>;
    for (const ctx of BOUNDED_CONTEXTS) {
      const svc = new vpclattice.CfnService(this, `${pascal(ctx)}Service`, {
        name: `s2s-${ctx}`,
        authType: 'AWS_IAM',
      });

      new vpclattice.CfnServiceNetworkServiceAssociation(this, `${pascal(ctx)}NetAssoc`, {
        serviceNetworkIdentifier: this.serviceNetwork.attrArn,
        serviceIdentifier: svc.attrArn,
      });

      new vpclattice.CfnListener(this, `${pascal(ctx)}Listener`, {
        serviceIdentifier: svc.attrArn,
        protocol: 'HTTPS',
        port: 443,
        defaultAction: { fixedResponse: { statusCode: 404 } },
      });

      new CfnOutput(this, `${pascal(ctx)}LatticeServiceArn`, {
        value: svc.attrArn,
        exportName: `${this.stackName}-${pascal(ctx)}LatticeServiceArn`,
      });
      services[ctx] = svc;
    }
    this.servicesByContext = services;

    new CfnOutput(this, 'ServiceNetworkArn', {
      value: this.serviceNetwork.attrArn,
      exportName: `${this.stackName}-ServiceNetworkArn`,
    });
  }
}
