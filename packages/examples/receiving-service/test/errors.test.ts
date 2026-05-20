import { describe, it, expect } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { sendAuthError, type AuthErrorCode } from '../src/lib/errorResponse.js';

const cases: Array<{ code: AuthErrorCode; status: number; dpop: boolean }> = [
  { code: 'invalid_token',          status: 401, dpop: true  },
  { code: 'token_expired',          status: 401, dpop: true  },
  { code: 'invalid_audience',       status: 401, dpop: true  },
  { code: 'invalid_dpop_proof',     status: 401, dpop: true  },
  { code: 'dpop_binding_mismatch',  status: 401, dpop: true  },
  { code: 'dpop_token_mismatch',    status: 401, dpop: true  },
  { code: 'dpop_proof_expired',     status: 401, dpop: true  },
  { code: 'dpop_nonce_reuse',       status: 401, dpop: true  },
  { code: 'authorization_denied',   status: 403, dpop: false },
];

function build(handler: (req: Request, res: Response) => void) {
  return express().get('/x', handler);
}

describe('§4.3 auth error schema', () => {
  for (const c of cases) {
    it(`returns ${c.status} ${c.code} with required fields`, async () => {
      const app = build((req, res) =>
        sendAuthError(req, res, { status: c.status, code: c.code, description: 'd', includeDPoPHeader: c.dpop }),
      );
      const res = await request(app).get('/x').set('x-request-id', 'r1');
      expect(res.status).toBe(c.status);
      expect(res.body.error).toBe(c.code);
      expect(res.body.error_description).toBe('d');
      expect(res.body.request_id).toBe('r1');
      expect(typeof res.body.timestamp).toBe('string');
      expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
      if (c.dpop) expect(res.headers['www-authenticate']).toBe('DPoP');
      else expect(res.headers['www-authenticate']).toBeUndefined();
    });
  }
});
