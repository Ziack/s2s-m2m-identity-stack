#!/usr/bin/env tsx
import {
  VerifiedPermissionsClient,
  PutSchemaCommand,
  CreatePolicyCommand,
  ListPoliciesCommand,
  DeletePolicyCommand,
} from '@aws-sdk/client-verifiedpermissions';
import { loadSchema, loadAllPolicies } from '../src/loader.js';

export interface UploadOptions {
  policyStoreId: string;
  region: string;
  replace: boolean;
}

export interface UploadResult {
  schemaUploaded: boolean;
  policiesCreated: number;
  policiesDeleted: number;
}

export async function uploadToAvp(opts: UploadOptions): Promise<UploadResult> {
  const client = new VerifiedPermissionsClient({ region: opts.region });

  // 1. Put schema. AVP accepts the human-readable Cedar schema under the
  //    `cedarJson` field name (the SDK's typing names this field for the
  //    JSON projection, but it accepts the textual schema in current AVP).
  const schema = loadSchema();
  await client.send(new PutSchemaCommand({
    policyStoreId: opts.policyStoreId,
    definition: { cedarJson: schema },
  } as unknown as ConstructorParameters<typeof PutSchemaCommand>[0]));

  // 2. Optionally delete existing static policies for a clean replace.
  let deleted = 0;
  if (opts.replace) {
    const list = await client.send(new ListPoliciesCommand({
      policyStoreId: opts.policyStoreId,
    }));
    const existing = (list as { policies?: Array<{ policyId: string }> }).policies ?? [];
    for (const p of existing) {
      await client.send(new DeletePolicyCommand({
        policyStoreId: opts.policyStoreId,
        policyId: p.policyId,
      }));
      deleted += 1;
    }
  }

  // 3. Create one static policy per .cedar file (concatenated statements per file).
  const policies = loadAllPolicies();
  let created = 0;
  for (const [name, content] of Object.entries(policies)) {
    await client.send(new CreatePolicyCommand({
      policyStoreId: opts.policyStoreId,
      definition: {
        static: {
          description: `M2M ${name} policies`,
          statement: content,
        },
      },
    }));
    created += 1;
  }

  return { schemaUploaded: true, policiesCreated: created, policiesDeleted: deleted };
}

async function main(): Promise<void> {
  const policyStoreId = process.env.AVP_POLICY_STORE_ID;
  if (!policyStoreId) {
    console.error('FAIL: AVP_POLICY_STORE_ID env var is required');
    process.exit(1);
  }
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const replace = process.env.AVP_REPLACE === 'true';
  const result = await uploadToAvp({ policyStoreId, region, replace });
  console.log(`OK: uploaded schema=${result.schemaUploaded} created=${result.policiesCreated} deleted=${result.policiesDeleted}`);
}

const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  main().catch((err) => {
    console.error('FAIL:', err);
    process.exit(1);
  });
}
