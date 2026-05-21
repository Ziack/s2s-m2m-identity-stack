import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
import { main } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function sh(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, CI: 'true' } });
    let out = ''; let err = '';
    p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('error', (e: NodeJS.ErrnoException) => {
      // spawn-level failures (e.g. ENOENT when the binary is missing) surface
      // here rather than via the close event. Treat them like a non-zero exit
      // with the error message captured on stderr so callers can branch.
      err += (e.message ?? String(e)) + '\n';
      res({ code: 127, out, err });
    });
    p.on('close', (code) => res({ code: code ?? 0, out, err }));
  });
}

describe.skipIf(process.env.CI_SKIP_E2E === 'true')('e2e: scaffold + install + build + tf validate', () => {
  it('produces a project that compiles and terraform validates', async () => {
    const dst = await mkdtemp(join(tmpdir(), 's2s-e2e-'));
    const cfg = resolve(__dirname, 'fixtures/test-config.json');

    const code = await main({ cwd: process.cwd(), argv: [dst, '--non-interactive', `--config=${cfg}`] });
    expect(code).toBe(0);

    // The scaffolded project depends on @s2s/auth-library at the CLI's own version,
    // which is not published to npm during local development. Rewrite the dep to
    // point at the local workspace so `npm install` resolves it.
    const repoRoot = resolve(__dirname, '..', '..', '..');
    const authLibPath = resolve(repoRoot, 'packages', 'auth-library');
    const pkgPath = join(dst, 'package.json');
    const pkgJson = JSON.parse(await readFile(pkgPath, 'utf8'));
    pkgJson.dependencies['@s2s/auth-library'] = `file:${authLibPath}`;
    await writeFile(pkgPath, JSON.stringify(pkgJson, null, 2));

    const install = await sh('npm', ['install', '--no-audit', '--no-fund'], dst);
    expect(install.code, install.err).toBe(0);

    const build = await sh('npx', ['tsc', '--noEmit'], dst);
    expect(build.code, build.err || build.out).toBe(0);

    const test = await sh('npm', ['test', '--silent'], dst);
    expect(test.code, test.err).toBe(0);

    const tfInit = await sh('terraform', ['init', '-backend=false', '-input=false'], join(dst, 'terraform'));
    if (tfInit.code !== 0 && /command not found|ENOENT|spawn terraform/i.test(tfInit.err)) {
      // Terraform not installed in this environment — skip the validate assertion but don't fail the suite.
      return;
    }
    expect(tfInit.code, tfInit.err).toBe(0);

    const tfValidate = await sh('terraform', ['validate'], join(dst, 'terraform'));
    expect(tfValidate.code, tfValidate.err).toBe(0);
  }, 180_000);
});
