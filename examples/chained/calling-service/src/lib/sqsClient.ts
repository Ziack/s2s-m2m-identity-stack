import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const client = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

export async function sendMessage(queueUrl: string, body: string): Promise<{ MessageId?: string | undefined }> {
  const out = await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
  return { MessageId: out.MessageId };
}
