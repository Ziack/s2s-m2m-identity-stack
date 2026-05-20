import { describe, it, expect } from 'vitest';
import { redact, truncateHash, getLogger } from '../../src/observability/logger.js';

describe('logger helpers', () => {
  it('redacts sensitive fields', () => {
    const out = redact({ caller_client_id: 'abc', access_token: 'eyJ...' });
    expect(out.access_token).toBe('[REDACTED]');
    expect(out.caller_client_id).toBe('abc');
  });

  it('truncateHash returns first 8 chars', () => {
    expect(truncateHash('abcdefghijkl')).toBe('abcdefgh');
  });

  it('getLogger returns same instance', () => {
    expect(getLogger()).toBe(getLogger());
  });
});
