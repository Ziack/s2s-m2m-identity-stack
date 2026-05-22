/**
 * Unit tests for the broker-aware middleware factory `createBrokerAuthMiddleware`.
 * Drives the middleware with fully-mocked SDK doubles (validate / verifyDPoP /
 * authorize) so we can assert:
 *   - happy-path req.auth shape (user + actor_chain attached)
 *   - tokens signed by the wrong issuer / missing act claim are rejected
 *   - actor chain depth cap is enforced
 *   - the AVP authorize context map carries user + actor_chain
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request } from 'express';
import request from 'supertest';
import {
  createBrokerAuthMiddleware,
  actorChainAsString,
  MAX_ACTOR_CHAIN_DEPTH,
} from '../src/lib/brokerAuthMiddleware.js';
import { AuthError, ERROR_CODES } from '@s2s/auth-library';
import type { ValidatedToken } from '@s2s/auth-library';

function makeValidated(overrides: Partial<ValidatedToken> & { raw: Record<string, unknown> }): ValidatedToken {
  return {
    sub: 'user-alice',
    scope: ['receiving/write'],
    iss: 'http://broker',
    aud: 'receiving',
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
    expectedAudience: 'receiving',
    resourcePrefix: 'lending',
    sourceDomain: 'receiving',
    action: 'POST_loan_application',
    resourceGroup: 'lending-resources',
  });
  const app = express();
  app.use(express.json());
  app.post('/api/loans', mw, (req: Request, res) => {
    res.status(200).json({ auth: (req as any).auth });
  });
  return app;
}

describe('createBrokerAuthMiddleware', () => {
  let doubles: Doubles;
  beforeEach(() => {
    doubles = {
      validateToken: vi.fn(),
      verifyDPoP: vi.fn(async () => ({})),
      authorize: vi.fn(async () => ({ decision: 'ALLOW', reasons: [] })),
    };
  });

  it('happy path: validates broker token, attaches user + actor_chain to req.auth', async () => {
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        sub: 'user-alice',
        raw: {
          iss: 'http://broker',
          sub: 'user-alice',
          roles: ['lending-officer'],
          groups: ['lending-team'],
          act: { sub: 'calling-service' },
        },
      }),
    );

    const res = await request(buildApp(doubles))
      .post('/api/loans')
      .set('authorization', 'DPoP tok-good')
      .set('dpop', 'proof-good')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.auth.sub).toBe('user-alice');
    expect(res.body.auth.user).toMatchObject({
      sub: 'user-alice',
      roles: ['lending-officer'],
      groups: ['lending-team'],
    });
    expect(res.body.auth.actor_chain).toEqual({ sub: 'calling-service' });
    expect(res.body.auth.token).toBe('tok-good');
  });

  it('AVP authorize is called with user + actor_chain in context', async () => {
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        raw: {
          iss: 'http://broker',
          sub: 'user-alice',
          roles: ['lending-officer'],
          act: { sub: 'receiving-outbound', act: { sub: 'calling-service' } },
        },
      }),
    );

    await request(buildApp(doubles))
      .post('/api/loans')
      .set('authorization', 'DPoP tok')
      .set('dpop', 'proof')
      .send({});

    expect(doubles.authorize).toHaveBeenCalledTimes(1);
    const call = doubles.authorize.mock.calls[0]![0] as { context: Record<string, unknown> };
    expect(call.context.dpop_confirmed).toBe(true);
    expect(call.context.source_domain).toBe('receiving');
    expect(call.context.user).toMatchObject({
      sub: 'user-alice',
      roles: ['lending-officer'],
    });
    // Innermost-first → outermost-last.
    expect(call.context.actor_chain).toEqual(['calling-service', 'receiving-outbound']);
  });

  it('AVP authorize is called with namespaced, route-bound principal/action/resource', async () => {
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        sub: 'calling-service',
        raw: {
          iss: 'http://broker',
          sub: 'calling-service',
          roles: ['lending-officer'],
          act: { sub: 'calling-service' },
        },
      }),
    );

    await request(buildApp(doubles))
      .post('/api/loans')
      .set('authorization', 'DPoP tok')
      .set('dpop', 'proof')
      .send({});

    expect(doubles.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: 'M2M::ServicePrincipal::calling-service',
        action: 'M2M::Action::POST_loan_application',
        resource: 'M2M::ResourceGroup::lending-resources',
      }),
    );
  });

  it('rejects token signed by wrong issuer (validateToken throws) → 401 invalid_token', async () => {
    doubles.validateToken.mockRejectedValue(
      new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'unexpected iss claim'),
    );
    const res = await request(buildApp(doubles))
      .post('/api/loans')
      .set('authorization', 'DPoP tok-cognito')
      .set('dpop', 'proof')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects token without act claim → 401 invalid_token', async () => {
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        raw: { iss: 'http://broker', sub: 'user-alice' }, // no `act`
      }),
    );
    const res = await request(buildApp(doubles))
      .post('/api/loans')
      .set('authorization', 'DPoP tok')
      .set('dpop', 'proof')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    expect(res.body.error_description).toMatch(/act claim/);
  });

  it(`rejects when actor_chain depth exceeds ${MAX_ACTOR_CHAIN_DEPTH}`, async () => {
    // Build a chain depth of MAX+1.
    let chain: any = { sub: `hop-${MAX_ACTOR_CHAIN_DEPTH + 1}` };
    for (let i = MAX_ACTOR_CHAIN_DEPTH; i >= 1; i -= 1) {
      chain = { sub: `hop-${i}`, act: chain };
    }
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        raw: { iss: 'http://broker', sub: 'user-alice', act: chain },
      }),
    );
    const res = await request(buildApp(doubles))
      .post('/api/loans')
      .set('authorization', 'DPoP tok')
      .set('dpop', 'proof')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    expect(res.body.error_description).toMatch(/depth/);
  });

  it('rejects missing Authorization header', async () => {
    const res = await request(buildApp(doubles)).post('/api/loans').send({});
    expect(res.status).toBe(401);
    expect(res.body.error_description).toMatch(/Authorization/);
  });

  it('rejects missing DPoP header', async () => {
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        raw: { iss: 'http://broker', sub: 'user-alice', act: { sub: 'calling-service' } },
      }),
    );
    const res = await request(buildApp(doubles))
      .post('/api/loans')
      .set('authorization', 'DPoP tok')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_dpop_proof');
  });

  it('sets DPoP-Nonce response header on a nonce-challenge (verifyDPoP throws AuthError with challengeNonce)', async () => {
    doubles.validateToken.mockResolvedValue(
      makeValidated({
        raw: { iss: 'http://broker', sub: 'user-alice', act: { sub: 'calling-service' } },
      }),
    );
    doubles.verifyDPoP.mockRejectedValue(
      new AuthError(401, ERROR_CODES.USE_DPOP_NONCE, 'server requires DPoP-Nonce echo', {
        challengeNonce: 'nonce-from-server',
      }),
    );
    const res = await request(buildApp(doubles))
      .post('/api/loans')
      .set('authorization', 'DPoP tok')
      .set('dpop', 'proof')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('use_dpop_nonce');
    expect(res.headers['dpop-nonce']).toBe('nonce-from-server');
  });

  it('actorChainAsString flattens innermost-first', () => {
    const chain = { sub: 'receiving-outbound', act: { sub: 'calling-service' } };
    expect(actorChainAsString(chain)).toEqual(['calling-service', 'receiving-outbound']);
    expect(actorChainAsString(null)).toEqual([]);
  });
});
