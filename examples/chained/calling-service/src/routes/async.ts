import { Router, type Request, type Response } from 'express';
import { signEnvelope } from '@s2s/auth-library';
import { sendMessage } from '../lib/sqsClient.js';
import type { CallingServiceConfig } from '../config.js';

export function asyncRouter(config: CallingServiceConfig): Router {
  const router = Router();
  router.post('/async', async (req: Request, res: Response) => {
    try {
      const signed = await signEnvelope(req.body, {
        action: 'loan.decision.submit',
        queueArn: config.queueArn,
        scopes: config.scopes,
        clientId: config.clientId,
      });
      const messageBody = JSON.stringify({ envelope: signed.envelope, payload: signed.payload });
      const sent = await sendMessage(config.queueUrl, messageBody);
      res.status(202).json({ messageId: sent.MessageId, jti: signed.metadata.jti });
    } catch (err) {
      (req as Request & { log?: { error: (...args: unknown[]) => void } }).log?.error({ err }, 'async flow failed');
      res.status(502).json({
        error: 'publish_error',
        error_description: err instanceof Error ? err.message : 'unknown',
        request_id: req.header('x-request-id') ?? 'unknown',
        timestamp: new Date().toISOString(),
      });
    }
  });
  return router;
}
