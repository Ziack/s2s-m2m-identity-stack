import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processOneBatch } from '../src/consumers/sqsConsumer.js';
import pino from 'pino';

const receiveMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({
    send: (cmd: any) => {
      if (cmd.constructor.name === 'ReceiveMessageCommand') return receiveMock();
      if (cmd.constructor.name === 'DeleteMessageCommand') return deleteMock();
      return Promise.reject(new Error('unexpected command'));
    },
  })),
  ReceiveMessageCommand: class { constructor(public input: unknown) {} },
  DeleteMessageCommand: class { constructor(public input: unknown) {} },
}));

const verifyEnvelopeMock = vi.fn();
const authorizeMock = vi.fn();
vi.mock('../src/lib/envelopeAuth.js', () => ({
  verifyEnvelope: (...args: unknown[]) => verifyEnvelopeMock(...args),
  authorize: (...args: unknown[]) => authorizeMock(...args),
}));

const cfg = {
  port: 3000, expectedAudience: 'lending', expectedIssuer: 'https://issuer',
  jwksUri: 'https://issuer/.well-known/jwks.json', jwksRefreshHours: 1, nonceTtlSeconds: 120,
  policyStoreId: 'ps', resourcePrefix: 'lending',
  queueUrl: 'https://sqs/q', queueArn: 'arn:aws:sqs:us-east-1:1:q',
  redisEndpoint: 'r', awsRegion: 'us-east-1', logLevel: 'silent',
};
const logger = pino({ level: 'silent' });

describe('sqsConsumer.processOneBatch', () => {
  beforeEach(() => { receiveMock.mockReset(); deleteMock.mockReset(); verifyEnvelopeMock.mockReset(); authorizeMock.mockReset(); });

  it('verifies envelope, authorizes (schema-conformant), then deletes message', async () => {
    receiveMock.mockResolvedValue({
      Messages: [{ ReceiptHandle: 'rh-1', Body: JSON.stringify({ envelope: 'e1', payload: { x: 1 } }) }],
    });
    verifyEnvelopeMock.mockResolvedValue({
      principal: 'M2M::ServicePrincipal::calling-service',
      action: 'POST_loan_application',
      claims: { scopes: ['lending/write'], correlation_id: 'corr-1', user: { sub: 'user-alice', roles: ['loan-officer'], groups: [] } },
    });
    authorizeMock.mockResolvedValue({ decision: 'ALLOW', reasons: ['p1'], evaluationTimeMs: 5 });

    const result = await processOneBatch(cfg, logger);

    expect(result.processed).toBe(1);
    expect(authorizeMock).toHaveBeenCalledWith(expect.objectContaining({
      principal: 'M2M::ServicePrincipal::calling-service',
      action: 'M2M::Action::POST_loan_application',
      resource: 'M2M::ResourceGroup::lending-resources',
      context: expect.objectContaining({
        dpop_confirmed: false,
        envelope_verified: true,
        scopes: ['lending/write'],
        source_domain: 'lending',
        correlation_id: 'corr-1',
        user: { sub: 'user-alice', roles: ['loan-officer'], groups: [] },
      }),
    }));
    expect(deleteMock).toHaveBeenCalled();
  });

  it('does NOT delete message when envelope verification fails (let visibility timeout requeue)', async () => {
    receiveMock.mockResolvedValue({
      Messages: [{ ReceiptHandle: 'rh-2', Body: JSON.stringify({ envelope: 'bad', payload: {} }) }],
    });
    verifyEnvelopeMock.mockRejectedValue(new Error('body_hash mismatch'));

    const result = await processOneBatch(cfg, logger);
    expect(result.failed).toBe(1);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('deletes message when authorize DENY (do not infinite-retry policy violations)', async () => {
    receiveMock.mockResolvedValue({
      Messages: [{ ReceiptHandle: 'rh-3', Body: JSON.stringify({ envelope: 'e3', payload: {} }) }],
    });
    verifyEnvelopeMock.mockResolvedValue({ principal: 'p', action: 'a', claims: {} });
    authorizeMock.mockResolvedValue({ decision: 'DENY', reasons: ['forbidden'], evaluationTimeMs: 1 });

    const result = await processOneBatch(cfg, logger);
    expect(result.denied).toBe(1);
    expect(deleteMock).toHaveBeenCalled();
  });
});
