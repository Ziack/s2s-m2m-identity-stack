import { describe, it, expect } from 'vitest';
import { toAvpContextMap } from '../../src/authz/avpContext.js';

describe('toAvpContextMap', () => {
  it('encodes booleans, strings and numbers as typed AttributeValues', () => {
    expect(toAvpContextMap({ dpop_confirmed: true, source_domain: 'lending', request_hour: 3 })).toEqual({
      dpop_confirmed: { boolean: true },
      source_domain: { string: 'lending' },
      request_hour: { long: 3 },
    });
  });

  it('encodes string arrays as a set of strings', () => {
    expect(toAvpContextMap({ scopes: ['lending/write', 'lending/read'] })).toEqual({
      scopes: { set: [{ string: 'lending/write' }, { string: 'lending/read' }] },
    });
  });

  it('encodes a nested user record recursively', () => {
    expect(
      toAvpContextMap({ user: { sub: 'user-alice', roles: ['loan-officer'], groups: [] } }),
    ).toEqual({
      user: {
        record: {
          sub: { string: 'user-alice' },
          roles: { set: [{ string: 'loan-officer' }] },
          groups: { set: [] },
        },
      },
    });
  });

  it('omits undefined values', () => {
    expect(toAvpContextMap({ a: 'x', b: undefined })).toEqual({ a: { string: 'x' } });
  });

  it('throws on unsupported value types', () => {
    expect(() => toAvpContextMap({ bad: () => 1 })).toThrow(/unsupported/i);
  });
});
