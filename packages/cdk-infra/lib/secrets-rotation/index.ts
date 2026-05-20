/**
 * AWS Secrets Manager rotation Lambda for Cognito M2M client secrets.
 * Implements the four-step rotation contract: createSecret → setSecret → testSecret → finishSecret.
 */
import {
  SecretsManagerClient,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const sm = new SecretsManagerClient({});
const cognito = new CognitoIdentityProviderClient({});

interface RotationEvent {
  SecretId: string;
  ClientRequestToken: string;
  Step: 'createSecret' | 'setSecret' | 'testSecret' | 'finishSecret';
}

interface SecretValue {
  user_pool_id: string;
  client_id: string;
  client_secret: string;
}

export const handler = async (event: RotationEvent): Promise<void> => {
  const desc = await sm.send(new DescribeSecretCommand({ SecretId: event.SecretId }));
  if (!desc.RotationEnabled) throw new Error('Rotation not enabled');
  const versions = desc.VersionIdsToStages ?? {};
  if (!versions[event.ClientRequestToken]) throw new Error('Token not found in versions');
  if (versions[event.ClientRequestToken].includes('AWSCURRENT')) return;

  switch (event.Step) {
    case 'createSecret':  return createSecret(event);
    case 'setSecret':     return setSecret(event);
    case 'testSecret':    return testSecret(event);
    case 'finishSecret':  return finishSecret(event);
    default: throw new Error(`Unknown step: ${event.Step}`);
  }
};

async function createSecret(event: RotationEvent): Promise<void> {
  const current = await sm.send(new GetSecretValueCommand({
    SecretId: event.SecretId, VersionStage: 'AWSCURRENT',
  }));
  const parsed = JSON.parse(current.SecretString ?? '{}') as SecretValue;
  await sm.send(new PutSecretValueCommand({
    SecretId: event.SecretId,
    ClientRequestToken: event.ClientRequestToken,
    SecretString: JSON.stringify({ ...parsed, client_secret: 'PENDING_ROTATION' }),
    VersionStages: ['AWSPENDING'],
  }));
}

async function setSecret(event: RotationEvent): Promise<void> {
  const pending = await sm.send(new GetSecretValueCommand({
    SecretId: event.SecretId, VersionId: event.ClientRequestToken, VersionStage: 'AWSPENDING',
  }));
  const parsed = JSON.parse(pending.SecretString ?? '{}') as SecretValue;
  const describe = await cognito.send(new DescribeUserPoolClientCommand({
    UserPoolId: parsed.user_pool_id, ClientId: parsed.client_id,
  }));
  await cognito.send(new UpdateUserPoolClientCommand({
    UserPoolId: parsed.user_pool_id,
    ClientId: parsed.client_id,
    AllowedOAuthFlows: describe.UserPoolClient?.AllowedOAuthFlows,
    AllowedOAuthFlowsUserPoolClient: describe.UserPoolClient?.AllowedOAuthFlowsUserPoolClient,
    AllowedOAuthScopes: describe.UserPoolClient?.AllowedOAuthScopes,
    AccessTokenValidity: describe.UserPoolClient?.AccessTokenValidity,
    TokenValidityUnits: describe.UserPoolClient?.TokenValidityUnits,
    EnableTokenRevocation: describe.UserPoolClient?.EnableTokenRevocation,
  }));
  const rotated = await cognito.send(new DescribeUserPoolClientCommand({
    UserPoolId: parsed.user_pool_id, ClientId: parsed.client_id,
  }));
  await sm.send(new PutSecretValueCommand({
    SecretId: event.SecretId,
    ClientRequestToken: event.ClientRequestToken,
    SecretString: JSON.stringify({ ...parsed, client_secret: rotated.UserPoolClient?.ClientSecret ?? '' }),
    VersionStages: ['AWSPENDING'],
  }));
}

async function testSecret(event: RotationEvent): Promise<void> {
  const pending = await sm.send(new GetSecretValueCommand({
    SecretId: event.SecretId, VersionId: event.ClientRequestToken, VersionStage: 'AWSPENDING',
  }));
  const parsed = JSON.parse(pending.SecretString ?? '{}') as SecretValue;
  if (!parsed.client_secret || parsed.client_secret === 'PENDING_ROTATION') {
    throw new Error('Pending secret does not contain a real client_secret');
  }
}

async function finishSecret(event: RotationEvent): Promise<void> {
  const desc = await sm.send(new DescribeSecretCommand({ SecretId: event.SecretId }));
  const versions = desc.VersionIdsToStages ?? {};
  let currentVersion: string | undefined;
  for (const [vid, stages] of Object.entries(versions)) {
    if (stages.includes('AWSCURRENT')) { currentVersion = vid; break; }
  }
  await sm.send(new UpdateSecretVersionStageCommand({
    SecretId: event.SecretId,
    VersionStage: 'AWSCURRENT',
    MoveToVersionId: event.ClientRequestToken,
    RemoveFromVersionId: currentVersion,
  }));
}
