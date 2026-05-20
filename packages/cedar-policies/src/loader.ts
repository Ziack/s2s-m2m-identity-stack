import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(here, '..');

export function loadSchema(): string {
  return readFileSync(join(PACKAGE_ROOT, 'schema.cedarschema'), 'utf8');
}

export function loadPolicyFile(name: string): string {
  return readFileSync(join(PACKAGE_ROOT, 'policies', `${name}.cedar`), 'utf8');
}

export function loadAllPolicies(): Record<string, string> {
  const dir = join(PACKAGE_ROOT, 'policies');
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.cedar')) continue;
    const name = f.replace(/\.cedar$/, '');
    out[name] = readFileSync(join(dir, f), 'utf8');
  }
  return out;
}
