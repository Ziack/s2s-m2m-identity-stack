import { describe, it, expect } from 'vitest';
import { AuthError, ERROR_CODES, buildErrorBody, wwwAuthenticateHeader } from '../src/errors.js';

describe('errors', () => {
  it('builds error body per §4.3', () => {
    const body = buildErrorBody({ code: ERROR_CODES.INVALID_TOKEN, description: 'missing header', requestId: 'rid-1' });
    expect(body.error).toBe('invalid_token');
    expect(body.error_description).toBe('missing header');
    expect(body.request_id).toBe('rid-1');
    expect(typeof body.timestamp).toBe('string');
    expect(body.timestamp).toMatch(/T.*Z$/);
  });

  it('AuthError carries http status + code', () => {
    const e = new AuthError(401, ERROR_CODES.DPOP_NONCE_REUSE, 'replay');
    expect(e.status).toBe(401);
    expect(e.code).toBe('dpop_nonce_reuse');
    expect(e.message).toBe('replay');
  });

  it('wwwAuthenticateHeader emits DPoP scheme for DPoP-related codes', () => {
    expect(wwwAuthenticateHeader(ERROR_CODES.INVALID_DPOP_PROOF)).toMatch(/^DPoP /);
    expect(wwwAuthenticateHeader(ERROR_CODES.DPOP_NONCE_REUSE)).toMatch(/^DPoP /);
    expect(wwwAuthenticateHeader(ERROR_CODES.AUTHORIZATION_DENIED)).toMatch(/^Bearer /);
  });
});
