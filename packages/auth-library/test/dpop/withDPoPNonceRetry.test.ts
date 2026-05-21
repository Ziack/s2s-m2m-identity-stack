import { describe, it, expect, vi } from 'vitest';
import { withDPoPNonceRetry } from '../../src/dpop/withDPoPNonceRetry.js';
import { AuthError, ERROR_CODES } from '../../src/errors.js';

describe('withDPoPNonceRetry', () => {
  it('passes through on first success; nonce arg undefined on first call', async () => {
    const fn = vi.fn(async (nonce: string | undefined) => {
      expect(nonce).toBeUndefined();
      return 'ok';
    });
    const result = await withDPoPNonceRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once on AuthError USE_DPOP_NONCE, echoing nonce', async () => {
    let calls = 0;
    const fn = vi.fn(async (nonce: string | undefined) => {
      calls += 1;
      if (calls === 1) {
        expect(nonce).toBeUndefined();
        throw new AuthError(401, ERROR_CODES.USE_DPOP_NONCE, 'nonce required', {
          challengeNonce: 'abc123',
        });
      }
      expect(nonce).toBe('abc123');
      return 'ok';
    });
    const result = await withDPoPNonceRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on other AuthError codes', async () => {
    const fn = vi.fn(async () => {
      throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'bad token');
    });
    await expect(withDPoPNonceRetry(fn)).rejects.toBeInstanceOf(AuthError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry twice', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      throw new AuthError(401, ERROR_CODES.USE_DPOP_NONCE, 'nonce required', {
        challengeNonce: calls === 1 ? 'n1' : 'n2',
      });
    });
    try {
      await withDPoPNonceRetry(fn);
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).challengeNonce).toBe('n2');
    }
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('non-AuthError errors propagate unchanged', async () => {
    const boom = new Error('network down');
    const fn = vi.fn(async () => {
      throw boom;
    });
    await expect(withDPoPNonceRetry(fn)).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
