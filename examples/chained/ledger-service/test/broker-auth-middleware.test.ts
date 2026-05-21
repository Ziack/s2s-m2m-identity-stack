/**
 * Unit tests for ledger-service's `createBrokerAuthMiddleware`. Mirrors the
 * receiving-service suite but exercises ledger-specific defaults
 * (audience='ledger', source_domain='ledger').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request } from 'express';
import request from 'supertest';
import {
  createBrokerAuthMiddleware,
  actorChainAsString,
} from '../src/lib/brokerAuthMiddleware.js';
import { AuthError, ERROR_CODES } from '@s2s/auth-library';
import type { ValidatedToken } from '@s2s/auth-library';

function makeValidated(overrides: Partial<ValidatedToken> & { raw: Record<string, unknown> }): ValidatedToken {
  return {
    sub: 'user-alice',
    scope: ['ledger/write'],
    iss: 'http://broker',
    aud: 'ledger',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

interface Doubles {
  validateToken: ReturnType<typeof vi.fn>;
  verifyDPoP: ReturnType<typeof vi.fn>;
  authorize: ReturnType<typeof vi.fn>;
}

function buildApp(doubles: Doubles) {
  const mw = createBrokerAuthMiddleware({
    validateToken: doubles.validateToken as any,
    verifyDPoP: doubles.verifyDPoP as any,
    authorize: doubles.authorize as any,
    expectedAudience: 'ledger',
    resourcePrefix: 'ledger',
    sourceDomain: 'ledger',
  });
  const app = express();
  app.use(express.json());
  app.post('/api/ledger/entries', mw, (req: Request, res) => {
    res.status(200).json({ auth: (req as any).auth });
  });
  return app;
}

describe('ledger createBrokerAuthMiddleware', () => {
  let doubles: Doubles;
  beforeEach(() => {
    doubles = {
      validateToken: vi.fn(),
      verifyDPoP: vi.fn(async () => ({})),
      authorize: vi.fn(async () => ({ decision: 'ALLOW', reasons: [] })),
    };
  });

  it('happy path: 2-hop actor chain extracted from inbound token', async () => {
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        raw: {
          iss: 'http://broker',
          sub: 'user-alice',
          roles: ['lending-officer'],
          act: { sub: 'receiving-service-outbound', act: { sub: 'calling-service' } },
        },
      }),
    );

    const res = await request(buildApp(doubles))
      .post('/api/ledger/entries')
      .set('authorization', 'DPoP tok')
      .set('dpop', 'proof')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.auth.user.sub).toBe('user-alice');
    expect(res.body.auth.actor_chain).toEqual({
      sub: 'receiving-service-outbound',
      act: { sub: 'calling-service' },
    });
    expect(actorChainAsString(res.body.auth.actor_chain)).toEqual([
      'calling-service',
      'receiving-service-outbound',
    ]);
  });

  it('AVP context carries source_domain=ledger', async () => {
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        raw: { iss: 'http://broker', sub: 'user-alice', act: { sub: 'receiving-outbound' } },
      }),
    );
    await request(buildApp(doubles))
      .post('/api/ledger/entries')
      .set('authorization', 'DPoP tok')
      .set('dpop', 'proof')
      .send({});
    const call = doubles.authorize.mock.calls[0]![0] as { context: Record<string, unknown> };
    expect(call.context.source_domain).toBe('ledger');
    expect(call.context.actor_chain).toEqual(['receiving-outbound']);
  });

  it('rejects token signed by wrong issuer → 401', async () => {
    doubles.validateToken.mockRejectedValue(
      new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'unexpected iss claim'),
    );
    const res = await request(buildApp(doubles))
      .post('/api/ledger/entries')
      .set('authorization', 'DPoP tok')
      .set('dpop', 'proof')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });
});
