import { describe, it, expect } from 'vitest';
import { withSpan, SPAN_NAMES } from '../../src/observability/tracing.js';

describe('withSpan', () => {
  it('runs the function and returns its value', async () => {
    const v = await withSpan(SPAN_NAMES.TOKEN_ACQUIRE, async () => 42);
    expect(v).toBe(42);
  });
  it('propagates thrown errors', async () => {
    await expect(withSpan('x', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
