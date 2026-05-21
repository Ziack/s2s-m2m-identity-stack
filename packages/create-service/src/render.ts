import { readdir, readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import ejs from 'ejs';

export class RenderError extends Error {}

export interface RenderOptions {
  templateDir: string;
  targetDir: string;
  data: Record<string, unknown>;
  existingApp: boolean;
}

const EXISTING_APP_KEEP_PREFIXES = ['terraform', 'policies'];

export async function assertEmptyDir(dir: string, force: boolean): Promise<void> {
  if (force) return;
  try {
    const entries = await readdir(dir);
    const nonHidden = entries.filter((e) => !e.startsWith('.'));
    if (nonHidden.length > 0) {
      throw new RenderError(`refusing to write into non-empty directory: ${dir}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (err instanceof RenderError) throw err;
    throw err;
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

export async function renderTemplate(opts: RenderOptions): Promise<void> {
  await mkdir(opts.targetDir, { recursive: true });
  for await (const abs of walk(opts.templateDir)) {
    const rel = relative(opts.templateDir, abs);
    if (opts.existingApp) {
      const top = rel.split(/[\\/]/)[0] ?? '';
      if (!EXISTING_APP_KEEP_PREFIXES.includes(top)) continue;
    }
    const isEjs = abs.endsWith('.ejs');
    const outRel = isEjs ? rel.slice(0, -'.ejs'.length) : rel;
    const outAbs = join(opts.targetDir, outRel);
    await mkdir(dirname(outAbs), { recursive: true });
    if (isEjs) {
      const tpl = await readFile(abs, 'utf8');
      const rendered = ejs.render(tpl, opts.data, { filename: abs });
      await writeFile(outAbs, rendered);
    } else {
      await copyFile(abs, outAbs);
    }
  }
}

export async function dirExists(dir: string): Promise<boolean> {
  try { await stat(dir); return true; } catch { return false; }
}
