import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

describe('validate.ts script', () => {
  it('exits 0 when schema and policies are valid', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/validate.ts'], {
      cwd: pkgRoot,
      encoding: 'utf8',
    });
    expect(out).toMatch(/OK:/);
    expect(out).toMatch(/schema parsed/);
    expect(out).toMatch(/all policies valid/);
  });
});
