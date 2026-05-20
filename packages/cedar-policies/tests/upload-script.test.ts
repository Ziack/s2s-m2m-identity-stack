import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-verifiedpermissions', () => {
  class VerifiedPermissionsClient {
    constructor(_: unknown) {}
    send = sendMock;
  }
  class PutSchemaCommand {
    constructor(public input: unknown) {}
  }
  class CreatePolicyCommand {
    constructor(public input: unknown) {}
  }
  class ListPoliciesCommand {
    constructor(public input: unknown) {}
  }
  class DeletePolicyCommand {
    constructor(public input: unknown) {}
  }
  return { VerifiedPermissionsClient, PutSchemaCommand, CreatePolicyCommand, ListPoliciesCommand, DeletePolicyCommand };
});

import { uploadToAvp } from '../scripts/upload-to-avp.js';

describe('upload-to-avp', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ policies: [], policyId: 'p-fake' });
  });

  it('calls PutSchema then CreatePolicy for each policy file', async () => {
    const result = await uploadToAvp({
      policyStoreId: 'ps-123',
      region: 'us-east-1',
      replace: false,
    });
    expect(sendMock).toHaveBeenCalled();
    expect(result.schemaUploaded).toBe(true);
    expect(result.policiesCreated).toBeGreaterThanOrEqual(6);
  });
});
