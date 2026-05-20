#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { devEnv } from '../lib/shared/env';
import { CognitoM2MStack } from '../lib/cognito-m2m-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { ElastiCacheStack } from '../lib/elasticache-stack';
import { AvpCedarStack } from '../lib/avp-cedar-stack';
import { LatticeStack } from '../lib/lattice-stack';
import { HybridBrokerStack } from '../lib/hybrid-broker-stack';
import { EcrStack } from '../lib/ecr-stack';
import { ExampleServicesStack } from '../lib/example-services-stack';

const app = new App();
const env = devEnv();

const cognitoStack = new CognitoM2MStack(app, 'CognitoM2MStack', { env });

const placeholderTaskRoleArn = `arn:aws:iam::${env.account ?? '000000000000'}:role/s2s-m2m-task-role-placeholder`;

const secretsStack = new SecretsStack(app, 'SecretsStack', {
  env,
  userPool: cognitoStack.userPool,
  clientsByContext: cognitoStack.clientsByContext,
  taskRoleArns: [placeholderTaskRoleArn],
});
// Implicit dependency: SecretsStack consumes cognitoStack.userPool / clientsByContext via
// cross-stack token refs, which CDK already wires. We deliberately do NOT call
// `secretsStack.addDependency(cognitoStack)` here, because Task 8 inverts the deploy
// order with `cognitoStack.addDependency(secretsStack)` for the secret-bootstrap custom
// resource and adding both would form a cycle.

const cacheStack = new ElastiCacheStack(app, 'ElastiCacheStack', { env });
void cacheStack;

const avpStack = new AvpCedarStack(app, 'AvpCedarStack', { env, userPool: cognitoStack.userPool });
avpStack.addDependency(cognitoStack);

const latticeStack = new LatticeStack(app, 'LatticeStack', { env });
void latticeStack;

const hybridStack = new HybridBrokerStack(app, 'HybridBrokerStack', {
  env,
  onPremCidr: process.env.S2S_ONPREM_CIDR ?? '10.50.0.0/16',
  customerVpnGatewayIp: process.env.S2S_VPN_CUSTOMER_IP ?? '203.0.113.10',
  customerBgpAsn: Number(process.env.S2S_VPN_BGP_ASN ?? 65000),
});
void hybridStack;

const ecrStack = new EcrStack(app, 'EcrStack', {
  env,
  encryptionKey: secretsStack.secretsKey,
});
ecrStack.addDependency(secretsStack);

cognitoStack.attachSecretBootstrap(secretsStack.secretsByContext);
// DEVIATION (plan Step 2b.4): plan instructs `cognitoStack.addDependency(secretsStack)`
// for deploy ordering, but SecretsStack already consumes CognitoStack tokens
// (UserPool ARN) — closing the loop in either direction creates a CDK
// stack-dependency cycle. attachSecretBootstrap above was updated to
// reconstruct secret ARNs from the deterministic name `m2m/<ctx>/client-secret`,
// severing the reverse token edge. The CR's runtime PutSecretValue call will
// still need the SM secret to exist at deploy time, which is enforced by the
// explicit `cdk deploy` order in plan Task 9 (Secrets before Cognito bootstrap
// happens implicitly via the CR's onCreate vs. onUpdate semantics).

// === Plan 04 extension point ===
// ExampleServicesStack (Fargate calling + receiving services) is added by
// packages/cdk-infra/plan-04 via an Edit to this file. It MUST consume:
//   - ecrStack.callingRepo / ecrStack.receivingRepo (NOT redeclare ECR repos)
//   - secretsStack.secretsByContext (for client_secret reads)
//   - cacheStack.workloadSg (so Fargate tasks can reach Valkey)
//   - cognitoStack.batchClient (for batch jobs).

// Plan 04: ExampleServicesStack — Fargate calling + receiving services.
// Property derivations (plan-04 drift):
//   - cacheStack exposes `workloadSg`/`vpc`/`cache` (no direct `redisEndpoint` field) → derive
//     redis endpoint from `cache.attrEndpointAddress`.
//   - cognitoStack does not surface `cognitoDomain` / `lendingClientId` / `lendingClientSecretArn`
//     as top-level fields → derive from `clientsByContext.lending` and `secretsByContext.lending`.
//   - avpStack exposes `policyStores` map (not `lendingPolicyStoreId`) → use
//     `policyStores.lending.attrPolicyStoreId`.
const lendingClient = cognitoStack.clientsByContext.lending;
const lendingSecret = secretsStack.secretsByContext.lending;
const exampleServices = new ExampleServicesStack(app, 'ExampleServicesStack', {
  env,
  kmsCmkArn: secretsStack.secretsKey.keyArn,
  imageTag: process.env.IMAGE_TAG ?? 'initial',
  vpcId: cacheStack.vpc.vpcId,
  privateSubnetIds: cacheStack.vpc.privateSubnets.map((s) => s.subnetId),
  workloadSecurityGroupId: cacheStack.workloadSg.securityGroupId,
  cognitoDomain: `s2s-m2m.auth.${env.region ?? 'us-east-1'}.amazoncognito.com`,
  lendingClientId: lendingClient.userPoolClientId,
  lendingClientSecretArn: lendingSecret.secretArn,
  redisEndpoint: cacheStack.cache.attrEndpointAddress,
  avpLendingPolicyStoreId: avpStack.policyStores.lending.attrPolicyStoreId,
});
exampleServices.addDependency(ecrStack);
exampleServices.addDependency(avpStack);
exampleServices.addDependency(cacheStack);
exampleServices.addDependency(secretsStack);

app.synth();
