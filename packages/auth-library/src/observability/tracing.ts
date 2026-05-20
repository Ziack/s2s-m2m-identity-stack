import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

const TRACER_NAME = '@s2s/auth-library';

export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

export const SPAN_NAMES = {
  TOKEN_ACQUIRE: 'm2m.token.acquire',
  DPOP_SIGN: 'm2m.dpop.sign',
  REQUEST_SEND: 'm2m.request.send',
  TOKEN_VALIDATE: 'm2m.token.validate',
  DPOP_VERIFY: 'm2m.dpop.verify',
  NONCE_CHECK: 'm2m.nonce.check',
  AUTHZ_EVALUATE: 'm2m.authz.evaluate',
} as const;
