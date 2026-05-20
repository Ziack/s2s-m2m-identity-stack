import { describe, it, expect, beforeAll } from 'vitest';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { initKeyPair, _resetKeyManagerForTest } from '../../src/dpop/keyManager.js';
import { signEnvelope } from '../../src/envelope/signEnvelope.js';
import { createHash } from 'node:crypto';

describe('signEnvelope', () => {
  beforeAll(async () => {
    _resetKeyManagerForTest();
    await initKeyPair();
  });

  it('produces a JWS with required claims and body_hash', async () => {
    const payload = { loanId: 'L-1', amount: 1000 };
    const signed = await signEnvelope(payload, {
      action: 'loan.decision.submit',
      queueArn: 'arn:aws:sqs:us-east-1:1:loanQ',
      scopes: ['lending/write'],
      clientId: 'lending-svc',
    });
    expect(typeof signed.envelope).toBe('string');
    const claims = decodeJwt(signed.envelope);
    expect(claims.iss).toBe('ServicePrincipal::lending-svc');
    expect(claims.action).toBe('loan.decision.submit');
    expect(claims.queue_arn).toBe('arn:aws:sqs:us-east-1:1:loanQ');
    expect(claims.scopes).toEqual(['lending/write']);
    expect(typeof claims.jti).toBe('string');
    const expectedHash = createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
    expect(claims.body_hash).toBe(expectedHash);
    expect(signed.metadata.bodyHash).toBe(expectedHash);
  });

  it('signs Buffer payloads using raw bytes for body_hash', async () => {
    const buf = Buffer.from('binary-payload');
    const signed = await signEnvelope(buf, {
      action: 'a',
      queueArn: 'arn:1',
      scopes: ['x'],
      clientId: 'c',
    });
    const expected = createHash('sha256').update(buf).digest('base64url');
    expect(signed.metadata.bodyHash).toBe(expected);
  });

  it('uses provided correlationId if set', async () => {
    const signed = await signEnvelope({}, { action: 'a', queueArn: 'q', scopes: [], clientId: 'c', correlationId: 'corr-123' });
    expect(decodeJwt(signed.envelope).correlation_id).toBe('corr-123');
  });

  it('protected header uses ES256 with embedded jwk', async () => {
    const signed = await signEnvelope({}, { action: 'a', queueArn: 'q', scopes: [], clientId: 'c' });
    const header = decodeProtectedHeader(signed.envelope);
    expect(header.alg).toBe('ES256');
    expect(header.jwk).toBeDefined();
  });
});
