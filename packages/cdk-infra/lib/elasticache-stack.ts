import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface ElastiCacheStackProps extends StackProps {}

export class ElastiCacheStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cacheSg: ec2.SecurityGroup;
  public readonly workloadSg: ec2.SecurityGroup;
  public readonly cache: elasticache.CfnServerlessCache;
  public readonly atRestKey: kms.Key;

  constructor(scope: Construct, id: string, props: ElastiCacheStackProps = {}) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'M2MVpc', {
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    this.atRestKey = new kms.Key(this, 'ValkeyAtRestKey', {
      alias: 'alias/s2s-m2m-valkey-at-rest',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.workloadSg = new ec2.SecurityGroup(this, 'WorkloadSg', {
      vpc: this.vpc,
      description: 'M2M workloads allowed to talk to Valkey',
      allowAllOutbound: true,
    });

    this.cacheSg = new ec2.SecurityGroup(this, 'ValkeySg', {
      vpc: this.vpc,
      description: 'Valkey cache: inbound 6379 from workload SG only',
      allowAllOutbound: false,
    });
    this.cacheSg.addIngressRule(
      this.workloadSg,
      ec2.Port.tcp(6379),
      'Valkey from workloads only',
    );

    this.cache = new elasticache.CfnServerlessCache(this, 'ValkeyCache', {
      engine: 'valkey',
      majorEngineVersion: '7',
      serverlessCacheName: 's2s-m2m-valkey',
      description: 'M2M token + DPoP nonce cache (TLS, KMS-CMK, private)',
      kmsKeyId: this.atRestKey.keyArn,
      securityGroupIds: [this.cacheSg.securityGroupId],
      subnetIds: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
    });

    new CfnOutput(this, 'ValkeyEndpoint', { value: this.cache.attrEndpointAddress, exportName: `${this.stackName}-ValkeyEndpoint` });
    new CfnOutput(this, 'ValkeyPort', { value: this.cache.attrEndpointPort, exportName: `${this.stackName}-ValkeyPort` });
    new CfnOutput(this, 'ValkeySgId', { value: this.cacheSg.securityGroupId, exportName: `${this.stackName}-ValkeySgId` });
    new CfnOutput(this, 'WorkloadSgId', { value: this.workloadSg.securityGroupId, exportName: `${this.stackName}-WorkloadSgId` });
    new CfnOutput(this, 'VpcId', { value: this.vpc.vpcId, exportName: `${this.stackName}-VpcId` });
  }
}
