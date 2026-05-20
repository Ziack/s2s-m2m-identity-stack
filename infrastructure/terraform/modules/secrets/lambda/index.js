/**
 * AWS Secrets Manager rotation Lambda for Cognito M2M client secrets.
 * Four-step rotation: createSecret -> setSecret -> testSecret -> finishSecret.
 *
 * Plain JS (CommonJS, Node 20 runtime) so `archive_file` can zip the folder
 * directly without a TypeScript build step.
 */
'use strict';

const {
  SecretsManagerClient,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  UpdateSecretVersionStageCommand,
} = require('@aws-sdk/client-secrets-manager');
const {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const sm = new SecretsManagerClient({});
const cognito = new CognitoIdentityProviderClient({});

exports.handler = async (event) => {
  const desc = await sm.send(new DescribeSecretCommand({ SecretId: event.SecretId }));
  if (!desc.RotationEnabled) throw new Error('Rotation not enabled');
  const versions = desc.VersionIdsToStages || {};
  if (!versions[event.ClientRequestToken]) throw new Error('Token not found in versions');
  if (versions[event.ClientRequestToken].includes('AWSCURRENT')) return;

  switch (event.Step) {
    case 'createSecret':
      return createSecret(event);
    case 'setSecret':
      return setSecret(event);
    case 'testSecret':
      return testSecret(event);
    case 'finishSecret':
      return finishSecret(event);
    default:
      throw new Error('Unknown step: ' + event.Step);
  }
};

async function createSecret(event) {
  const current = await sm.send(new GetSecretValueCommand({
    SecretId: event.SecretId,
    VersionStage: 'AWSCURRENT',
  }));
  const parsed = JSON.parse(current.SecretString || '{}');
  await sm.send(new PutSecretValueCommand({
    SecretId: event.SecretId,
    ClientRequestToken: event.ClientRequestToken,
    SecretString: JSON.stringify(Object.assign({}, parsed, { client_secret: 'PENDING_ROTATION' })),
    VersionStages: ['AWSPENDING'],
  }));
}

async function setSecret(event) {
  const pending = await sm.send(new GetSecretValueCommand({
    SecretId: event.SecretId,
    VersionId: event.ClientRequestToken,
    VersionStage: 'AWSPENDING',
  }));
  const parsed = JSON.parse(pending.SecretString || '{}');
  const describe = await cognito.send(new DescribeUserPoolClientCommand({
    UserPoolId: parsed.user_pool_id,
    ClientId: parsed.client_id,
  }));
  await cognito.send(new UpdateUserPoolClientCommand({
    UserPoolId: parsed.user_pool_id,
    ClientId: parsed.client_id,
    AllowedOAuthFlows: describe.UserPoolClient && describe.UserPoolClient.AllowedOAuthFlows,
    AllowedOAuthFlowsUserPoolClient: describe.UserPoolClient && describe.UserPoolClient.AllowedOAuthFlowsUserPoolClient,
    AllowedOAuthScopes: describe.UserPoolClient && describe.UserPoolClient.AllowedOAuthScopes,
    AccessTokenValidity: describe.UserPoolClient && describe.UserPoolClient.AccessTokenValidity,
    TokenValidityUnits: describe.UserPoolClient && describe.UserPoolClient.TokenValidityUnits,
    EnableTokenRevocation: describe.UserPoolClient && describe.UserPoolClient.EnableTokenRevocation,
  }));
  const rotated = await cognito.send(new DescribeUserPoolClientCommand({
    UserPoolId: parsed.user_pool_id,
    ClientId: parsed.client_id,
  }));
  await sm.send(new PutSecretValueCommand({
    SecretId: event.SecretId,
    ClientRequestToken: event.ClientRequestToken,
    SecretString: JSON.stringify(Object.assign({}, parsed, {
      client_secret: (rotated.UserPoolClient && rotated.UserPoolClient.ClientSecret) || '',
    })),
    VersionStages: ['AWSPENDING'],
  }));
}

async function testSecret(event) {
  const pending = await sm.send(new GetSecretValueCommand({
    SecretId: event.SecretId,
    VersionId: event.ClientRequestToken,
    VersionStage: 'AWSPENDING',
  }));
  const parsed = JSON.parse(pending.SecretString || '{}');
  if (!parsed.client_secret || parsed.client_secret === 'PENDING_ROTATION') {
    throw new Error('Pending secret does not contain a real client_secret');
  }
}

async function finishSecret(event) {
  const desc = await sm.send(new DescribeSecretCommand({ SecretId: event.SecretId }));
  const versions = desc.VersionIdsToStages || {};
  let currentVersion;
  for (const [vid, stages] of Object.entries(versions)) {
    if (stages.includes('AWSCURRENT')) {
      currentVersion = vid;
      break;
    }
  }
  await sm.send(new UpdateSecretVersionStageCommand({
    SecretId: event.SecretId,
    VersionStage: 'AWSCURRENT',
    MoveToVersionId: event.ClientRequestToken,
    RemoveFromVersionId: currentVersion,
  }));
}
