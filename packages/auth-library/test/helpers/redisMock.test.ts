import { describe, it, expect } from 'vitest';
import { RedisMock } from './redisMock.js';

describe('RedisMock', () => {
  it('SET NX returns null on conflict', async () => {
    const r = new RedisMock();
    expect(await r.set('k', 'v', 'EX', 60, 'NX')).toBe('OK');
    expect(await r.set('k', 'v2', 'EX', 60, 'NX')).toBe(null);
  });
  it('TTL expires entries', async () => {
    let t = 1000;
    const r = new RedisMock();
    r.setNowFn(() => t);
    await r.set('k', 'v', 'EX', 1);
    expect(await r.get('k')).toBe('v');
    t += 2000;
    expect(await r.get('k')).toBe(null);
  });
});
