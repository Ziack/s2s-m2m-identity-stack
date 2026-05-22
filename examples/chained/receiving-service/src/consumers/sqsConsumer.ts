import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { verifyEnvelope, authorize } from '../lib/envelopeAuth.js';
import type { Logger } from 'pino';
import type { ReceivingServiceConfig } from '../config.js';

export interface BatchResult { processed: number; denied: number; failed: number; }

export async function processOneBatch(config: ReceivingServiceConfig, logger: Logger): Promise<BatchResult> {
  const client = new SQSClient({ region: config.awsRegion });
  const out = await client.send(new ReceiveMessageCommand({
    QueueUrl: config.queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 5, VisibilityTimeout: 30,
  }));
  const result: BatchResult = { processed: 0, denied: 0, failed: 0 };
  for (const msg of out.Messages ?? []) {
    try {
      const parsed = JSON.parse(msg.Body ?? '{}');
      const verified = await verifyEnvelope(
        { envelope: parsed.envelope, payload: parsed.payload },
        { expectedQueueArn: config.queueArn },
      );
      const claims = (verified as unknown as {
        claims?: { scopes?: string[]; jti?: string; correlation_id?: string; user?: { sub: string; roles: string[]; groups: string[] } };
      }).claims ?? {};
      const resourceGroup = `${config.resourcePrefix}-resources`;
      const context: Record<string, unknown> = {
        dpop_confirmed: false, // async path is envelope-sender-constrained, not DPoP
        scopes: claims.scopes ?? [],
        source_domain: config.resourcePrefix,
        correlation_id: claims.correlation_id ?? msg.MessageId ?? 'unknown',
        ...(claims.user ? { user: claims.user } : {}),
      };
      const decision = await authorize({
        principal: verified.principal,
        action: `M2M::Action::${(verified as unknown as { action?: string }).action ?? 'unknown'}`,
        resource: `M2M::ResourceGroup::${resourceGroup}`,
        context,
      });
      if (decision.decision === 'ALLOW') {
        logger.info({ jti: claims.jti, principal: verified.principal }, 'message processed');
        result.processed += 1;
      } else {
        logger.warn({ principal: verified.principal, reasons: decision.reasons }, 'authz_decision=DENY');
        result.denied += 1;
      }
      await client.send(new DeleteMessageCommand({ QueueUrl: config.queueUrl, ReceiptHandle: msg.ReceiptHandle }));
    } catch (err) {
      logger.error({ err }, 'envelope verification failed; leaving for retry');
      result.failed += 1;
    }
  }
  return result;
}

export async function startSqsConsumer(config: ReceivingServiceConfig, logger: Logger): Promise<void> {
  while (true) {
    try { await processOneBatch(config, logger); }
    catch (err) { logger.error({ err }, 'consumer loop error'); await new Promise((r) => setTimeout(r, 1000)); }
  }
}
