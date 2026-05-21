import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli-args.js';

describe('parseArgs', () => {
  it('positional target dir', () => {
    const a = parseArgs(['my-svc']);
    expect(a.targetDir).toBe('my-svc');
    expect(a.nonInteractive).toBe(false);
  });

  it('parses --non-interactive with flags', () => {
    const a = parseArgs([
      'my-svc',
      '--non-interactive',
      '--service-name=loan',
      '--bounded-context=lending',
      '--scopes=lending/read,lending/write',
      '--container-port=4000',
      '--alb-path=/api/loan/*',
      '--environment=dev',
      '--outbound-audiences=ledger,deposits',
      '--region=us-east-1',
    ]);
    expect(a.nonInteractive).toBe(true);
    expect(a.flags.serviceName).toBe('loan');
    expect(a.flags.scopes).toEqual(['lending/read', 'lending/write']);
    expect(a.flags.containerPort).toBe(4000);
    expect(a.flags.outboundAudiences).toEqual(['ledger', 'deposits']);
  });

  it('--config loads JSON file', () => {
    const a = parseArgs(['my-svc', '--config=./fixtures/cfg.json']);
    expect(a.configPath).toBe('./fixtures/cfg.json');
  });

  it('--existing-app flips mode', () => {
    const a = parseArgs(['--existing-app', '.']);
    expect(a.existingApp).toBe(true);
    expect(a.targetDir).toBe('.');
  });

  it('--force allows overwrite', () => {
    const a = parseArgs(['my-svc', '--force']);
    expect(a.force).toBe(true);
  });

  it('--help', () => {
    const a = parseArgs(['--help']);
    expect(a.help).toBe(true);
  });
});
