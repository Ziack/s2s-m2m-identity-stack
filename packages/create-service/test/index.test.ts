import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/index.js';

vi.mock('../src/ssm.js', () => ({
  lookupBoundedContexts: vi.fn(async () => null),
  _clearCache: () => {},
}));

let dst: string;
beforeEach(async () => {
  dst = await mkdtemp(join(tmpdir(), 'cs-idx-'));
});

describe('main (non-interactive)', () => {
  it('renders a project from the bundled template with config file', async () => {
    const tpl = await mkdtemp(join(tmpdir(), 'tpl-'));
    await writeFile(join(tpl, 'package.json.ejs'), '{"name":"<%= serviceName %>"}');
    const cfgPath = join(tpl, 'cfg.json');
    await writeFile(cfgPath, JSON.stringify({
      serviceName: 'svc-x', boundedContext: 'lending', scopes: ['lending/read'],
      containerPort: 3000, albPathPattern: '/api/svc-x/*', environment: 'dev',
      outboundAudiences: [], generateSampleCedar: true,
    }));
    process.env.S2S_TEMPLATE_DIR = tpl;
    const code = await main({
      cwd: process.cwd(),
      argv: [dst, '--non-interactive', `--config=${cfgPath}`],
    });
    delete process.env.S2S_TEMPLATE_DIR;
    expect(code).toBe(0);
    const pkg = await readFile(join(dst, 'package.json'), 'utf8');
    expect(pkg).toContain('"name":"svc-x"');
  });

  it('non-zero exit on invalid service name', async () => {
    const code = await main({
      cwd: process.cwd(),
      argv: [dst, '--non-interactive', '--service-name=INVALID', '--bounded-context=lending', '--scopes=lending/read', '--container-port=3000', '--alb-path=/api/x/*', '--environment=dev'],
    });
    expect(code).not.toBe(0);
  });

  it('refuses to overwrite non-empty target', async () => {
    await writeFile(join(dst, 'existing'), '');
    const code = await main({ cwd: process.cwd(), argv: [dst, '--non-interactive', '--service-name=svc', '--bounded-context=lending', '--scopes=lending/read', '--container-port=3000', '--alb-path=/api/svc/*', '--environment=dev'] });
    expect(code).not.toBe(0);
  });
});
