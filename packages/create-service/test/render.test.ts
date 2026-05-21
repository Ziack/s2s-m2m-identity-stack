import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplate, assertEmptyDir, RenderError } from '../src/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(__dirname, 'fixtures/mini-template');

let dst: string;
beforeEach(async () => {
  dst = await mkdtemp(join(tmpdir(), 'cs-render-'));
});

describe('renderTemplate', () => {
  it('substitutes EJS and copies static files', async () => {
    await renderTemplate({
      templateDir: TEMPLATE,
      targetDir: dst,
      data: { serviceName: 'svc', boundedContext: 'lending' },
      existingApp: false,
    });
    const pkg = await readFile(join(dst, 'package.json'), 'utf8');
    expect(pkg).toContain('"name":"svc"');
    const readme = await readFile(join(dst, 'README.md'), 'utf8');
    expect(readme).toBe('# svc (lending)\n');
    const stat = await readFile(join(dst, 'static.txt'), 'utf8');
    expect(stat).toBe('verbatim\n');
  });

  it('strips .ejs extension on output', async () => {
    await renderTemplate({ templateDir: TEMPLATE, targetDir: dst, data: { serviceName: 'x', boundedContext: 'y' }, existingApp: false });
    const entries = await readdir(dst);
    expect(entries).toEqual(expect.arrayContaining(['package.json', 'README.md', 'static.txt']));
    expect(entries).not.toContain('package.json.ejs');
  });
});

describe('assertEmptyDir', () => {
  it('passes for empty dir', async () => {
    await expect(assertEmptyDir(dst, false)).resolves.toBeUndefined();
  });
  it('throws RenderError if dir has files and not force', async () => {
    await writeFile(join(dst, 'x'), '');
    await expect(assertEmptyDir(dst, false)).rejects.toBeInstanceOf(RenderError);
  });
  it('passes if force=true', async () => {
    await writeFile(join(dst, 'x'), '');
    await expect(assertEmptyDir(dst, true)).resolves.toBeUndefined();
  });
});

describe('existing-app mode', () => {
  it('only writes terraform/ and policies/', async () => {
    const extDir = await mkdtemp(join(tmpdir(), 'tpl-ext-'));
    await mkdir(join(extDir, 'src'), { recursive: true });
    await writeFile(join(extDir, 'src/index.ts.ejs'), '// <%= serviceName %>');
    await mkdir(join(extDir, 'terraform'), { recursive: true });
    await writeFile(join(extDir, 'terraform/main.tf.ejs'), '# <%= serviceName %>');
    await mkdir(join(extDir, 'policies'), { recursive: true });
    await writeFile(join(extDir, 'policies/sample.cedar.ejs'), '// <%= boundedContext %>');
    await writeFile(join(extDir, 'package.json.ejs'), '{"n":"<%= serviceName %>"}');

    await renderTemplate({ templateDir: extDir, targetDir: dst, data: { serviceName: 's', boundedContext: 'b' }, existingApp: true });
    const entries = await readdir(dst);
    expect(entries).toEqual(expect.arrayContaining(['terraform', 'policies']));
    expect(entries).not.toContain('src');
    expect(entries).not.toContain('package.json');
  });
});
