import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface HybridBrokerStackProps extends StackProps {
  readonly onPremCidr: string;
  readonly customerVpnGatewayIp: string;
  readonly customerBgpAsn: number;
}

export class HybridBrokerStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;
  public readonly mappingTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: HybridBrokerStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'NetworkHubVpc', {
      maxAzs: 3,
      natGateways: 1,
      vpnGateway: true,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
      ],
    });

    const customerGw = new ec2.CfnCustomerGateway(this, 'OnPremCustomerGateway', {
      type: 'ipsec.1',
      bgpAsn: props.customerBgpAsn,
      ipAddress: props.customerVpnGatewayIp,
    });

    new ec2.CfnVPNConnection(this, 'SiteToSiteVpn', {
      customerGatewayId: customerGw.ref,
      type: 'ipsec.1',
      vpnGatewayId: this.vpc.vpnGatewayId!,
      staticRoutesOnly: false,
    });

    const ddbKey = new kms.Key(this, 'MappingTableKey', {
      alias: 'alias/s2s-m2m-hybrid-mapping',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.mappingTable = new dynamodb.Table(this, 'HybridMappingTable', {
      tableName: 's2s-m2m-hybrid-mapping',
      partitionKey: { name: 'on_prem_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: ddbKey,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const logGroup = new logs.LogGroup(this, 'BrokerLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.cluster = new ecs.Cluster(this, 'HybridBrokerCluster', {
      vpc: this.vpc,
      containerInsights: true,
      clusterName: 's2s-m2m-hybrid-broker',
    });

    const brokerService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'BrokerService', {
      cluster: this.cluster,
      desiredCount: 2,
      cpu: 512,
      memoryLimitMiB: 1024,
      publicLoadBalancer: false,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:1.27-alpine'),
        containerPort: 80,
        logDriver: ecs.LogDriver.awsLogs({ streamPrefix: 'broker', logGroup }),
        environment: {
          MAPPING_TABLE: this.mappingTable.tableName,
          LOG_LEVEL: 'info',
        },
      },
      healthCheckGracePeriod: Duration.seconds(60),
    });

    this.mappingTable.grantReadData(brokerService.taskDefinition.taskRole);

    const scaling = brokerService.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 65,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(30),
    });

    new CfnOutput(this, 'BrokerAlbDnsName', {
      value: brokerService.loadBalancer.loadBalancerDnsName,
      exportName: `${this.stackName}-BrokerAlbDnsName`,
    });
    new CfnOutput(this, 'MappingTableArn', {
      value: this.mappingTable.tableArn,
      exportName: `${this.stackName}-MappingTableArn`,
    });
  }
}
