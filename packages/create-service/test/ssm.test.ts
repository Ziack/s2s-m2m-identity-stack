import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookupBoundedContexts, _clearCache } from '../src/ssm.js';

const sendMock = vi.fn();
vi.mock('@aws-sdk/client-ssm', () => {
  class SSMClient { send = (...a: unknown[]) => sendMock(...a); }
  class GetParameterCommand { constructor(public input: unknown) {} }
  return { SSMClient, GetParameterCommand };
});

describe('lookupBoundedContexts', () => {
  beforeEach(() => { sendMock.mockReset(); _clearCache(); });

  it('returns parsed StringList on success', async () => {
    sendMock.mockResolvedValueOnce({ Parameter: { Value: 'lending,deposits,ledger', Type: 'StringList' } });
    const got = await lookupBoundedContexts({ environment: 'dev', region: 'us-east-1' });
    expect(got).toEqual(['lending', 'deposits', 'ledger']);
  });

  it('returns null when SSM rejects (no creds, missing param, etc.)', async () => {
    sendMock.mockRejectedValueOnce(new Error('Could not load credentials'));
    const got = await lookupBoundedContexts({ environment: 'dev', region: 'us-east-1' });
    expect(got).toBeNull();
  });

  it('caches results within a single CLI invocation for 5 minutes', async () => {
    sendMock.mockResolvedValueOnce({ Parameter: { Value: 'lending,deposits' } });
    await lookupBoundedContexts({ environment: 'dev', region: 'us-east-1' });
    await lookupBoundedContexts({ environment: 'dev', region: 'us-east-1' });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
