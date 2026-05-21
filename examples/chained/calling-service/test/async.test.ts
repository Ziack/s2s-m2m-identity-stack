import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { asyncRouter } from '../src/routes/async.js';

const sendMessageMock = vi.fn();
vi.mock('../src/lib/sqsClient.js', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

vi.mock('@s2s/auth-library', () => ({
  signEnvelope: vi.fn().mockResolvedValue({
    envelope: 'jws.compact.signature',
    payload: { decisionId: 'D-1' },
    metadata: { jti: 'env-jti', iat: 1700000000, bodyHash: 'hash', envelopeSizeBytes: 512 },
  }),
}));

const cfg = {
  port: 3000,
  clientId: 'lending-client',
  targetBaseUrl: 'x',
  targetAudience: 'lending',
  scopes: ['lending/write'],
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/LendingDecisionsQueue',
  queueArn: 'arn:aws:sqs:us-east-1:123:LendingDecisionsQueue',
  awsRegion: 'us-east-1',
  logLevel: 'silent',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/demo', asyncRouter(cfg));
  return app;
}

describe('POST /demo/async', () => {
  beforeEach(() => sendMessageMock.mockReset());

  it('signs envelope and publishes envelope + payload to SQS', async () => {
    sendMessageMock.mockResolvedValue({ MessageId: 'mid-1' });

    const res = await request(buildApp())
      .post('/demo/async')
      .send({ decisionId: 'D-1' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ messageId: 'mid-1', jti: 'env-jti' });
    expect(sendMessageMock).toHaveBeenCalledWith(
      cfg.queueUrl,
      expect.stringContaining('"envelope":"jws.compact.signature"'),
    );
    const sent = JSON.parse(sendMessageMock.mock.calls[0][1] as string);
    expect(sent.payload).toEqual({ decisionId: 'D-1' });
  });
});
