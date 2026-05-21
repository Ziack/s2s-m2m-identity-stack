import { describe, it, expect } from 'vitest';
import { CLI_VERSION } from '../src/version.js';

describe('version', () => {
  it('matches package.json', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(CLI_VERSION).toBe(pkg.default.version);
  });
});
