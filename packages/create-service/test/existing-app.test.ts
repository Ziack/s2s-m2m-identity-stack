import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('--existing-app mode', () => {
  it('writes only terraform/ + policies/ into a non-empty target', async () => {
    const dst = await mkdtemp(join(tmpdir(), 's2s-existing-'));
    // Pre-populate with an existing src/ + package.json
    await mkdir(join(dst, 'src'), { recursive: true });
    await writeFile(join(dst, 'src/server.ts'), '// existing app');
    await writeFile(join(dst, 'package.json'), JSON.stringify({ name: 'existing-app' }));

    const cfg = resolve(__dirname, 'fixtures/test-config.json');
    const code = await main({
      cwd: process.cwd(),
      argv: ['--existing-app', dst, '--non-interactive', `--config=${cfg}`],
    });
    expect(code).toBe(0);

    // Existing files preserved
    const pkg = await stat(join(dst, 'package.json'));
    expect(pkg.isFile()).toBe(true);
    const server = await stat(join(dst, 'src/server.ts'));
    expect(server.isFile()).toBe(true);

    // New dirs present
    const tf = await readdir(join(dst, 'terraform'));
    expect(tf).toEqual(expect.arrayContaining(['main.tf', 'variables.tf', 'outputs.tf', 'versions.tf']));
    const pol = await readdir(join(dst, 'policies'));
    expect(pol).toContain('sample.cedar');

    // Untouched: no src/index.ts overwrite, no new Dockerfile
    const entries = await readdir(dst);
    expect(entries).not.toContain('Dockerfile');
  });
});
