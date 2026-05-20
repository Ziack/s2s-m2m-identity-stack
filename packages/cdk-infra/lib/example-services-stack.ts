import { Stack, type StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export interface ExampleServicesStackProps extends StackProps {
  kmsCmkArn: string;
  /** Deterministic image tag (e.g. git short SHA). Defaults via `process.env.IMAGE_TAG ?? 'initial'` in bin/app.ts. */
  imageTag: string;
  vpcId: string;
  privateSubnetIds: string[];
  workloadSecurityGroupId: string;
  cognitoDomain: string;
  lendingClientId: string;
  lendingClientSecretArn: string;
  redisEndpoint: string;
  avpLendingPolicyStoreId: string;
}

export class ExampleServicesStack extends Stack {
  public readonly lendingQueue: sqs.Queue;
  public readonly lendingDlq: sqs.Queue;
  public readonly callingRepo: ecr.IRepository;
  public readonly receivingRepo: ecr.IRepository;
  public readonly cluster: ecs.Cluster;
  public readonly clusterLogs: logs.LogGroup;
  public readonly callingTaskRole: iam.Role;
  public readonly receivingTaskRole: iam.Role;
  public readonly executionRole: iam.Role;
  public readonly callingLogs: logs.LogGroup;
  public readonly callingTd: ecs.FargateTaskDefinition;
  public readonly callingService: ecs.FargateService;
  public readonly receivingLogs: logs.LogGroup;
  public readonly receivingTd: ecs.FargateTaskDefinition;
  public readonly receivingService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ExampleServicesStackProps) {
    super(scope, id, props);
    // All props now consumed (Task 15c+). Earlier `void props.X` placeholders removed.

    const cmk = kms.Key.fromKeyArn(this, 'Cmk', props.kmsCmkArn);

    this.lendingDlq = new sqs.Queue(this, 'LendingDecisionsDlq', {
      queueName: 'lending-decisions-dlq',
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: cmk,
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.lendingQueue = new sqs.Queue(this, 'LendingDecisionsQueue', {
      queueName: 'lending-decisions',
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: cmk,
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: this.lendingDlq, maxReceiveCount: 5 },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new CfnOutput(this, 'LendingQueueUrl', { value: this.lendingQueue.queueUrl, exportName: 'LendingQueueUrl' });
    new CfnOutput(this, 'LendingQueueArn', { value: this.lendingQueue.queueArn, exportName: 'LendingQueueArn' });

    // Plan 04 Task 14: look up ECR repos owned by Plan 02's EcrStack — DO NOT recreate.
    this.callingRepo = ecr.Repository.fromRepositoryName(this, 'CallingRepo', 's2s-calling-service');
    this.receivingRepo = ecr.Repository.fromRepositoryName(this, 'ReceivingRepo', 's2s-receiving-service');

    // Plan 04 Task 15a: Fargate cluster + cluster log group.
    // Use `fromVpcAttributes` instead of `fromLookup` so the stack synths offline
    // (deterministic for jest assertion tests).
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: [`${this.region}a`, `${this.region}b`],
      privateSubnetIds: props.privateSubnetIds,
    });
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc, clusterName: 's2s-s2s-poc', containerInsights: true,
    });
    this.clusterLogs = new logs.LogGroup(this, 'ClusterLogs', {
      logGroupName: '/s2s/cluster',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Plan 04 Task 15b: least-privilege task roles.
    const clientSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'ClientSecret', props.lendingClientSecretArn);
    const policyStoreArn = `arn:aws:verifiedpermissions::${this.account}:policy-store/${props.avpLendingPolicyStoreId}`;

    this.callingTaskRole = new iam.Role(this, 'CallingTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    clientSecret.grantRead(this.callingTaskRole);
    this.lendingQueue.grantSendMessages(this.callingTaskRole);
    this.callingTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['verifiedpermissions:IsAuthorizedWithToken'], resources: [policyStoreArn],
    }));
    this.callingTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['elasticache:DescribeCacheClusters'], resources: ['*'],
    }));

    this.receivingTaskRole = new iam.Role(this, 'ReceivingTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    clientSecret.grantRead(this.receivingTaskRole);
    this.lendingQueue.grantConsumeMessages(this.receivingTaskRole);
    this.receivingTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['verifiedpermissions:IsAuthorizedWithToken'], resources: [policyStoreArn],
    }));
    this.receivingTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['elasticache:DescribeCacheClusters'], resources: ['*'],
    }));

    this.executionRole = new iam.Role(this, 'ExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });
    this.callingRepo.grantPull(this.executionRole);
    this.receivingRepo.grantPull(this.executionRole);

    // Plan 04 Task 15c: calling-service Fargate task def + service.
    const workloadSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'WorkloadSg', props.workloadSecurityGroupId);
    const callingSubnets = props.privateSubnetIds.map((id, i) => ec2.Subnet.fromSubnetId(this, `CSub${i}`, id));

    this.callingLogs = new logs.LogGroup(this, 'CallingLogs', {
      logGroupName: '/s2s/calling-service', retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY,
    });

    const callingTd = new ecs.FargateTaskDefinition(this, 'CallingTd', {
      cpu: 512, memoryLimitMiB: 1024, taskRole: this.callingTaskRole, executionRole: this.executionRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    callingTd.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(this.callingRepo, props.imageTag),
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: this.callingLogs, streamPrefix: 'calling' }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        PORT: '3000',
        AWS_REGION: this.region,
        COGNITO_CLIENT_ID: props.lendingClientId,
        COGNITO_DOMAIN: props.cognitoDomain,
        M2M_CLIENT_SECRET_ARN: props.lendingClientSecretArn,
        REDIS_ENDPOINT: props.redisEndpoint,
        AVP_POLICY_STORE_ID: props.avpLendingPolicyStoreId,
        TARGET_AUDIENCE: 'lending',
        TARGET_SCOPES: 'lending/read,lending/write',
        LENDING_QUEUE_URL: this.lendingQueue.queueUrl,
        LENDING_QUEUE_ARN: this.lendingQueue.queueArn,
        // TARGET_BASE_URL is injected in 15e once the ALB DNS is known.
      },
    });

    this.callingService = new ecs.FargateService(this, 'CallingService', {
      cluster: this.cluster, taskDefinition: callingTd, desiredCount: 2, assignPublicIp: false,
      securityGroups: [workloadSg],
      vpcSubnets: { subnets: callingSubnets },
      enableExecuteCommand: true,
    });

    this.callingTd = callingTd;

    // Plan 04 Task 15d: receiving-service Fargate task def + service.
    const receivingSubnets = props.privateSubnetIds.map((id, i) => ec2.Subnet.fromSubnetId(this, `RSub${i}`, id));

    this.receivingLogs = new logs.LogGroup(this, 'ReceivingLogs', {
      logGroupName: '/s2s/receiving-service', retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY,
    });

    const receivingTd = new ecs.FargateTaskDefinition(this, 'ReceivingTd', {
      cpu: 512, memoryLimitMiB: 1024, taskRole: this.receivingTaskRole, executionRole: this.executionRole,
    });
    receivingTd.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(this.receivingRepo, props.imageTag),
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: this.receivingLogs, streamPrefix: 'receiving' }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        PORT: '3000',
        AWS_REGION: this.region,
        COGNITO_CLIENT_ID: props.lendingClientId,
        COGNITO_DOMAIN: props.cognitoDomain,
        M2M_CLIENT_SECRET_ARN: props.lendingClientSecretArn,
        REDIS_ENDPOINT: props.redisEndpoint,
        AVP_POLICY_STORE_ID: props.avpLendingPolicyStoreId,
        EXPECTED_AUDIENCE: 'lending',
        RESOURCE_PREFIX: 'lending',
        LENDING_QUEUE_URL: this.lendingQueue.queueUrl,
        LENDING_QUEUE_ARN: this.lendingQueue.queueArn,
      },
    });

    this.receivingService = new ecs.FargateService(this, 'ReceivingService', {
      cluster: this.cluster, taskDefinition: receivingTd, desiredCount: 2, assignPublicIp: false,
      securityGroups: [workloadSg],
      vpcSubnets: { subnets: receivingSubnets },
      enableExecuteCommand: true,
    });

    this.receivingTd = receivingTd;

    // Plan 04 Task 15e: internal ALB + listener + 2 target groups.
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, allowAllOutbound: true });
    albSg.addIngressRule(workloadSg, ec2.Port.tcp(80), 'workload -> ALB');

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc, internetFacing: false, securityGroup: albSg,
      vpcSubnets: { subnets: props.privateSubnetIds.map((id, i) => ec2.Subnet.fromSubnetId(this, `AlbSub${i}`, id)) },
    });

    // PoC: HTTP listener on port 80. Production should attach an ACM cert and use HTTPS on 443.
    const listener = alb.addListener('Http', {
      port: 80,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, { contentType: 'text/plain', messageBody: 'not_found' }),
    });

    listener.addTargets('Receiving', {
      port: 3000, targets: [this.receivingService], protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: { path: '/health', interval: Duration.seconds(15), healthyThresholdCount: 2, unhealthyThresholdCount: 3 },
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*', '/health', '/health/auth'])],
      priority: 10,
    });

    listener.addTargets('Calling', {
      port: 3000, targets: [this.callingService], protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: { path: '/health', interval: Duration.seconds(15) },
      conditions: [elbv2.ListenerCondition.pathPatterns(['/demo/*', '/metrics', '/.well-known/*'])],
      priority: 20,
    });

    // Inject TARGET_BASE_URL onto the calling container now that ALB DNS is known.
    this.callingTd.defaultContainer!.addEnvironment('TARGET_BASE_URL', `http://${alb.loadBalancerDnsName}`);

    new CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName, exportName: 'AlbDnsName' });
  }
}
