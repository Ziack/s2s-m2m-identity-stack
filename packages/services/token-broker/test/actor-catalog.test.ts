import { describe, it, expect } from 'vitest';
import { loadActorCatalog, hashClientSecret, loadActorCatalogFromFile } from '../src/lib/actorCatalog.js';
import { writeTempActorCatalog, sha256Hex } from './helpers/testFixtures.js';

describe('actorCatalog', () => {
  it('authenticates registered actors with correct secrets', () => {
    const catalog = loadActorCatalog({
      'calling-service': {
        client_secret_hash: hashClientSecret('s3cr3t'),
        allowed_audiences: ['receiving'],
        allowed_scopes: ['lending/write'],
      },
    });
    expect(catalog.authenticate('calling-service', 's3cr3t')).toBe(true);
  });

  it('rejects unknown actors and bad secrets', () => {
    const catalog = loadActorCatalog({
      'a': {
        client_secret_hash: `sha256:${sha256Hex('correct')}`,
        allowed_audiences: ['x'],
        allowed_scopes: ['s'],
      },
    });
    expect(catalog.authenticate('a', 'wrong')).toBe(false);
    expect(catalog.authenticate('b', 'correct')).toBe(false);
  });

  it('lists registered actors', () => {
    const catalog = loadActorCatalog({
      a: { client_secret_hash: hashClientSecret('x'), allowed_audiences: [], allowed_scopes: [] },
      b: { client_secret_hash: hashClientSecret('y'), allowed_audiences: [], allowed_scopes: [] },
    });
    expect(catalog.list().sort()).toEqual(['a', 'b']);
  });

  it('rejects entries with unsupported hash format at load time', () => {
    expect(() =>
      loadActorCatalog({
        a: { client_secret_hash: 'md5:abc', allowed_audiences: [], allowed_scopes: [] },
      }),
    ).toThrow(/unsupported client_secret_hash/);
  });

  it('loads from a JSON file on disk', () => {
    const path = writeTempActorCatalog({
      svc: {
        client_secret_hash: hashClientSecret('topsecret'),
        allowed_audiences: ['target'],
        allowed_scopes: ['read'],
      },
    });
    const catalog = loadActorCatalogFromFile(path);
    expect(catalog.authenticate('svc', 'topsecret')).toBe(true);
    expect(catalog.get('svc')?.allowed_audiences).toEqual(['target']);
  });
});
