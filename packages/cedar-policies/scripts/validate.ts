#!/usr/bin/env tsx
import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import { loadSchema, loadAllPolicies } from '../src/loader.js';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main(): void {
  const schema = loadSchema();

  // checkParseSchema only accepts JSON schemas; for the human-syntax schema we
  // round-trip through schemaToJsonWithResolvedTypes which validates and parses.
  const schemaParse = cedar.schemaToJsonWithResolvedTypes(schema);
  if (schemaParse.type !== 'success') {
    fail(`schema parse error: ${JSON.stringify(schemaParse, null, 2)}`);
  }
  console.log('OK: schema parsed');

  const policies = loadAllPolicies();
  const combined = Object.values(policies).join('\n\n');

  const parse = cedar.checkParsePolicySet({ staticPolicies: combined });
  if (parse.type !== 'success') {
    fail(`policy parse error: ${JSON.stringify(parse, null, 2)}`);
  }

  const validate = cedar.validate({
    policies: { staticPolicies: combined },
    schema: schema,
    validationSettings: { mode: 'strict' },
  });
  if (validate.type !== 'success') {
    fail(`validate call error: ${JSON.stringify(validate, null, 2)}`);
  }
  const errs = validate.validationErrors ?? [];
  if (errs.length > 0) {
    fail(`schema validation errors:\n${errs.map((e) => JSON.stringify(e)).join('\n')}`);
  }

  console.log(`OK: all policies valid (${Object.keys(policies).length} files)`);
}

main();
