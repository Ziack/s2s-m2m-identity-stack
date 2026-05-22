import { SignJWT } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import { getActivePrivateKey, getPublicJwk } from '../dpop/keyManager.js';
import type { SignedMessage } from '../types.js';

export interface SignEnvelopeOptions {
  action: string;
  queueArn: string;
  scopes: string[];
  clientId: string;
  correlationId?: string;
  /** Forwarded end-user identity for the async authorization path. */
  user?: { sub: string; roles: string[]; groups: string[] };
  additionalClaims?: Record<string, unknown>;
}

function hashPayload(payload: Buffer | object): { bodyHash: string; serialized: Buffer } {
  if (Buffer.isBuffer(payload)) {
    return { bodyHash: createHash('sha256').update(payload).digest('base64url'), serialized: payload };
  }
  const json = JSON.stringify(payload);
  return { bodyHash: createHash('sha256').update(json).digest('base64url'), serialized: Buffer.from(json) };
}

export async function signEnvelope(payload: Buffer | object, options: SignEnvelopeOptions): Promise<SignedMessage> {
  const { bodyHash, serialized } = hashPayload(payload);
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const correlationId = options.correlationId ?? randomUUID();
  const claims: Record<string, unknown> = {
    iss: `M2M::ServicePrincipal::${options.clientId}`,
    iat,
    jti,
    body_hash: bodyHash,
    correlation_id: correlationId,
    queue_arn: options.queueArn,
    action: options.action,
    scopes: options.scopes,
    ...(options.user ? { user: options.user } : {}),
    ...(options.additionalClaims ?? {}),
  };
  const envelope = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', jwk: getPublicJwk() })
    .sign(getActivePrivateKey());
  return {
    envelope,
    payload,
    metadata: {
      jti,
      iat,
      bodyHash,
      envelopeSizeBytes: Buffer.byteLength(envelope, 'utf8') + serialized.byteLength,
    },
  };
}
