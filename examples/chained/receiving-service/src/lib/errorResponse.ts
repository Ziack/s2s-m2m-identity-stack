import type { Request, Response } from 'express';

export type AuthErrorCode =
  | 'invalid_token'
  | 'token_expired'
  | 'invalid_audience'
  | 'invalid_dpop_proof'
  | 'dpop_binding_mismatch'
  | 'dpop_token_mismatch'
  | 'dpop_proof_expired'
  | 'dpop_nonce_reuse'
  | 'authorization_denied';

interface SendOpts {
  status: number;
  code: AuthErrorCode;
  description: string;
  includeDPoPHeader?: boolean;
}

export function sendAuthError(req: Request, res: Response, opts: SendOpts): void {
  if (opts.includeDPoPHeader) res.setHeader('WWW-Authenticate', 'DPoP');
  res.status(opts.status).json({
    error: opts.code,
    error_description: opts.description,
    request_id: req.header('x-request-id') ?? req.header('x-correlation-id') ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
}
