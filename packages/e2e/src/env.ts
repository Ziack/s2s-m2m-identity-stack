import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface E2eEnv {
  albBaseUrl: string;
  queueUrl: string;
  queueArn: string;
  callingLogGroup: string;
  receivingLogGroup: string;
  ledgerLogGroup: string;
  cognitoDomain: string;
  clientId: string;
  clientSecretArn: string;
  ledgerClientId: string;
  receivingOutboundClientId: string;
  ledgerSecretArn: string;
  receivingOutboundSecretArn: string;
  ledgerPolicyStoreId: string;
  region: string;
  runId: string;
}

/**
 * Shape of `terraform output -json`. Each top-level key is an output name; the
 * value is `{ value, type, sensitive }`. We only care about `.value`.
 */
type TerraformOutputJson = Record<string, { value: string; type?: unknown; sensitive?: boolean }>;

function read(outputs: TerraformOutputJson, key: string): string {
  return outputs[key]?.value ?? '';
}

export function loadE2eEnv(): E2eEnv {
  // packages/e2e/src/env.ts -> repo root is four `..` -> infrastructure/terraform/tf-outputs.json
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultOutputsPath = resolve(here, '../../../infrastructure/terraform/tf-outputs.json');
  const outputsPath = process.env.TF_OUTPUTS_PATH ?? defaultOutputsPath;
  const outputs = JSON.parse(readFileSync(outputsPath, 'utf8')) as TerraformOutputJson;

  const albDns = read(outputs, 'alb_dns_name');
  return {
    albBaseUrl: process.env.E2E_BASE_URL ?? (albDns ? `http://${albDns}` : ''),
    queueUrl: read(outputs, 'lending_queue_url'),
    queueArn: read(outputs, 'lending_queue_arn'),
    callingLogGroup: '/s2s/calling-service',
    receivingLogGroup: '/s2s/receiving-service',
    ledgerLogGroup: '/s2s/ledger-service',
    cognitoDomain: read(outputs, 'cognito_domain') || process.env.COGNITO_DOMAIN || '',
    clientId: read(outputs, 'cognito_lending_client_id') || process.env.COGNITO_CLIENT_ID || '',
    clientSecretArn: read(outputs, 'secrets_lending_arn') || process.env.M2M_CLIENT_SECRET_ARN || '',
    ledgerClientId: read(outputs, 'cognito_ledger_client_id') || process.env.COGNITO_LEDGER_CLIENT_ID || '',
    receivingOutboundClientId: read(outputs, 'cognito_receiving_outbound_client_id') || process.env.COGNITO_RECEIVING_OUTBOUND_CLIENT_ID || '',
    ledgerSecretArn: read(outputs, 'secrets_ledger_arn') || process.env.M2M_LEDGER_SECRET_ARN || '',
    receivingOutboundSecretArn: read(outputs, 'secrets_receiving_outbound_arn') || process.env.M2M_RECEIVING_OUTBOUND_SECRET_ARN || '',
    ledgerPolicyStoreId: read(outputs, 'avp_ledger_policy_store_id') || process.env.AVP_LEDGER_POLICY_STORE_ID || '',
    region: process.env.AWS_REGION ?? 'us-east-1',
    runId: process.env.E2E_RUN_ID ?? 'local',
  };
}
