import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface E2eEnv {
  albBaseUrl: string;
  queueUrl: string;
  queueArn: string;
  callingLogGroup: string;
  receivingLogGroup: string;
  cognitoDomain: string;
  clientId: string;
  clientSecretArn: string;
  region: string;
  runId: string;
}

export function loadE2eEnv(): E2eEnv {
  // Anchor relative to this source file: packages/e2e/src/env.ts → repo root is two `..` to
  // packages/, then `cdk-infra/cdk-outputs.json` under packages/.
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultOutputsPath = resolve(here, '../../cdk-infra/cdk-outputs.json');
  const outputsPath = process.env.CDK_OUTPUTS_PATH ?? defaultOutputsPath;
  const outputs = JSON.parse(readFileSync(outputsPath, 'utf8')) as Record<string, Record<string, string>>;
  const ex = outputs['ExampleServicesStack'] ?? outputs['ExampleServicesStack'] ?? {};
  const cog = outputs['CognitoM2MStack'] ?? outputs['CognitoStack'] ?? {};
  return {
    albBaseUrl: process.env.E2E_BASE_URL ?? `http://${ex['AlbDnsName']}`,
    queueUrl: ex['LendingQueueUrl'] ?? '',
    queueArn: ex['LendingQueueArn'] ?? '',
    callingLogGroup: '/s2s/calling-service',
    receivingLogGroup: '/s2s/receiving-service',
    cognitoDomain: cog['CognitoDomain'] ?? process.env.COGNITO_DOMAIN ?? '',
    clientId: cog['LendingClientId'] ?? process.env.COGNITO_CLIENT_ID ?? '',
    clientSecretArn: cog['LendingClientSecretArn'] ?? process.env.M2M_CLIENT_SECRET_ARN ?? '',
    region: process.env.AWS_REGION ?? 'us-east-1',
    runId: process.env.E2E_RUN_ID ?? 'local',
  };
}
