import { Environment } from 'aws-cdk-lib';

export function devEnv(): Environment {
  return {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  };
}
