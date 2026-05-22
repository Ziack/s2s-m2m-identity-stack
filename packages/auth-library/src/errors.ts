export const ERROR_CODES = {
  INVALID_TOKEN: 'invalid_token',
  TOKEN_EXPIRED: 'token_expired',
  INVALID_AUDIENCE: 'invalid_audience',
  INVALID_DPOP_PROOF: 'invalid_dpop_proof',
  DPOP_BINDING_MISMATCH: 'dpop_binding_mismatch',
  DPOP_TOKEN_MISMATCH: 'dpop_token_mismatch',
  DPOP_PROOF_EXPIRED: 'dpop_proof_expired',
  DPOP_NONCE_REUSE: 'dpop_nonce_reuse',
  DPOP_KEY_MISMATCH: 'dpop_key_mismatch',
  USE_DPOP_NONCE: 'use_dpop_nonce',
  AUTHORIZATION_DENIED: 'authorization_denied',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DPOP_CODES = new Set<ErrorCode>([
  ERROR_CODES.INVALID_DPOP_PROOF,
  ERROR_CODES.DPOP_BINDING_MISMATCH,
  ERROR_CODES.DPOP_TOKEN_MISMATCH,
  ERROR_CODES.DPOP_PROOF_EXPIRED,
  ERROR_CODES.DPOP_NONCE_REUSE,
  ERROR_CODES.DPOP_KEY_MISMATCH,
  ERROR_CODES.USE_DPOP_NONCE,
]);

export class AuthError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly challengeNonce?: string;
  public details?: Record<string, unknown>;
  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    opts?: { challengeNonce?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    if (opts?.challengeNonce) this.challengeNonce = opts.challengeNonce;
    if (opts?.details) this.details = opts.details;
  }
}

export interface ErrorBody {
  error: string;
  error_description: string;
  request_id: string;
  timestamp: string;
}

export function buildErrorBody(input: { code: ErrorCode; description: string; requestId: string }): ErrorBody {
  return {
    error: input.code,
    error_description: input.description,
    request_id: input.requestId,
    timestamp: new Date().toISOString(),
  };
}

export function wwwAuthenticateHeader(code: ErrorCode): string {
  if (DPOP_CODES.has(code)) {
    return `DPoP error="${code}"`;
  }
  return `Bearer error="${code}"`;
}
