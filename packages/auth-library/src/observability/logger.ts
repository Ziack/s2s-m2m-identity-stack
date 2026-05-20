import { pino, type Logger } from 'pino';

const SENSITIVE_FIELDS = new Set(['access_token', 'accessToken', 'client_secret', 'clientSecret', 'private_key', 'privateKey', 'dpop_proof', 'dpopProof']);

export function truncateHash(input: string): string {
  return input.slice(0, 8);
}

export function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

let _logger: Logger | null = null;

export function getLogger(): Logger {
  if (_logger === null) {
    _logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service: 'auth-library' },
      redact: { paths: ['access_token', 'accessToken', 'client_secret', 'clientSecret', '*.access_token', '*.client_secret'], remove: true },
      formatters: { level: (label: string) => ({ level: label }) },
    });
  }
  return _logger!;
}

export function resetLoggerForTest(): void {
  _logger = null;
}
