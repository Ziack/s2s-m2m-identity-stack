import { describe, it, expect } from 'vitest';
import { applyInsecureTlsEscapeHatch } from '../src/tls.js';

describe('applyInsecureTlsEscapeHatch', () => {
  it('does nothing when ALLOW_INSECURE_TLS is unset (default-OFF)', () => {
    const env: NodeJS.ProcessEnv = {};
    const warnings: string[] = [];
    const applied = applyInsecureTlsEscapeHatch(env, (m) => warnings.push(m));
    expect(applied).toBe(false);
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });

  it('does nothing when ALLOW_INSECURE_TLS is false', () => {
    const env: NodeJS.ProcessEnv = { ALLOW_INSECURE_TLS: 'false' };
    const applied = applyInsecureTlsEscapeHatch(env, () => {});
    expect(applied).toBe(false);
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it('disables TLS verification and warns when ALLOW_INSECURE_TLS=true', () => {
    const env: NodeJS.ProcessEnv = { ALLOW_INSECURE_TLS: 'true' };
    const warnings: string[] = [];
    const applied = applyInsecureTlsEscapeHatch(env, (m) => warnings.push(m));
    expect(applied).toBe(true);
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/SECURITY WARNING/);
  });

  it('is case-insensitive on the flag value', () => {
    const env: NodeJS.ProcessEnv = { ALLOW_INSECURE_TLS: 'TRUE' };
    const applied = applyInsecureTlsEscapeHatch(env, () => {});
    expect(applied).toBe(true);
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
  });
});
