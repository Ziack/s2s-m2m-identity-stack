import { describe, it, expect } from 'vitest';
import { extractActorChain } from '../../src/auth/extractActorChain.js';

describe('extractActorChain', () => {
  it('returns null when act is missing', () => {
    expect(extractActorChain({ sub: 'user' })).toBeNull();
  });

  it('returns null when act is not an object', () => {
    expect(extractActorChain({ sub: 'user', act: 'svc1' })).toBeNull();
    expect(extractActorChain({ sub: 'user', act: 42 })).toBeNull();
    expect(extractActorChain({ sub: 'user', act: null })).toBeNull();
    expect(extractActorChain({ sub: 'user', act: ['svc1'] })).toBeNull();
  });

  it('returns null when act.sub is missing or non-string', () => {
    expect(extractActorChain({ sub: 'user', act: {} })).toBeNull();
    expect(extractActorChain({ sub: 'user', act: { sub: 123 } })).toBeNull();
  });

  it('extracts single-hop actor', () => {
    const chain = extractActorChain({ sub: 'user', act: { sub: 'service1' } });
    expect(chain).toEqual({ sub: 'service1' });
  });

  it('extracts multi-hop nested actor chain', () => {
    const chain = extractActorChain({
      sub: 'user',
      act: { sub: 'service2', act: { sub: 'service1' } },
    });
    expect(chain).toEqual({ sub: 'service2', act: { sub: 'service1' } });
  });

  it('extracts three-hop chain', () => {
    const chain = extractActorChain({
      sub: 'user',
      act: { sub: 'svc3', act: { sub: 'svc2', act: { sub: 'svc1' } } },
    });
    expect(chain).toEqual({
      sub: 'svc3',
      act: { sub: 'svc2', act: { sub: 'svc1' } },
    });
  });

  it('truncates chain at first malformed nested act without throwing', () => {
    const chain = extractActorChain({
      sub: 'user',
      act: { sub: 'svc2', act: 'malformed' },
    });
    expect(chain).toEqual({ sub: 'svc2' });
  });

  it('ignores extra properties on act nodes', () => {
    const chain = extractActorChain({
      sub: 'user',
      act: { sub: 'svc1', iss: 'https://broker', random: 1 },
    });
    expect(chain).toEqual({ sub: 'svc1' });
  });
});
