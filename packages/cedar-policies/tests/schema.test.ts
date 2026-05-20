import { describe, it, expect } from 'vitest';
// Use the nodejs subpath: the default ESM entry loads .wasm asynchronously and is
// not compatible with Node's CommonJS-style import resolution; the nodejs build
// is synchronous and works under Vitest's worker pool.
import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import { loadSchema } from '../src/loader.js';

describe('schema', () => {
  it('parses as a valid Cedar schema (human syntax)', () => {
    const schema = loadSchema();
    // checkParseSchema only accepts JSON; schemaToJsonWithResolvedTypes is the
    // human-syntax-aware validator and is what we rely on in tests.
    const result = cedar.schemaToJsonWithResolvedTypes(schema);
    expect(result.type).toBe('success');
  });

  it('declares the M2M namespace with required entities and actions', () => {
    const schema = loadSchema();
    expect(schema).toMatch(/namespace\s+M2M\s*\{/);
    expect(schema).toMatch(/entity\s+ServicePrincipal/);
    expect(schema).toMatch(/entity\s+ResourceGroup/);
    expect(schema).toMatch(/action\s+POST_loan_application/);
    expect(schema).toMatch(/action\s+GET_loan_status/);
    expect(schema).toMatch(/action\s+POST_deposit/);
    expect(schema).toMatch(/action\s+POST_payment/);
    expect(schema).toMatch(/action\s+POST_fraud_signal/);
    expect(schema).toMatch(/action\s+POST_notification/);
    expect(schema).toMatch(/action\s+POST_account/);
  });

  it('declares optional user + actor_chain context fields (Phase 5)', () => {
    const schema = loadSchema();
    expect(schema).toMatch(/type\s+UserAttrs\s*=/);
    expect(schema).toMatch(/sub:\s*String/);
    expect(schema).toMatch(/roles:\s*Set<String>/);
    expect(schema).toMatch(/groups:\s*Set<String>/);
    expect(schema).toMatch(/user\?:\s*UserAttrs/);
    expect(schema).toMatch(/actor_chain\?:\s*Set<String>/);
  });
});
