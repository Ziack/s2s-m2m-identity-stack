/**
 * Thin wrapper around @s2s/auth-library factory exports so route handlers
 * can call simple `acquireToken(clientId, scopes)` / `signDPoP(opts)` shapes.
 *
 * `initAuthClient(config)` wires the real SDK factories (cache + breaker +
 * Cognito loader) at process startup. Tests bypass this by mocking the
 * module-level `acquireToken` / `signDPoP` exports.
 */
import {
  signDPoP as libSignDPoP,
  createAcquireToken,
  TokenCache,
  getRedisClient,
  getClientSecret,
  buildBreaker,
} from '@s2s/auth-library';
import type { TokenResult, DPoPProof } from '@s2s/auth-library';
import type { CallingServiceConfig } from '../config.js';

type AcquireFn = (clientId: string, scopes: string[]) => Promise<TokenResult>;

let acquireFn: AcquireFn | null = null;

export function setAcquireToken(fn: AcquireFn): void {
  acquireFn = fn;
}

/**
 * Resolve the Cognito client_secret from Secrets Manager and construct an
 * `acquireToken` implementation backed by the L1+L2 TokenCache. Idempotent.
 */
export async function initAuthClient(config: CallingServiceConfig): Promise<void> {
  if (acquireFn !== null) return;
  const secretJson = await getClientSecret(config.clientSecretArn, config.awsRegion);
  // Secret value is a JSON object: { user_pool_id, client_id, client_secret }.
  // Tolerate plain-string secrets for local fixtures.
  let clientSecret: string;
  try {
    const parsed = JSON.parse(secretJson) as { client_secret?: string };
    clientSecret = parsed.client_secret ?? secretJson;
  } catch {
    clientSecret = secretJson;
  }
  const redis = getRedisClient(config.redisEndpoint);
  const cache = new TokenCache({ redis });
  const breaker = buildBreaker('cognito', {
    failureThreshold: 5,
    halfOpenAfterMs: 30_000,
    samplingDurationMs: 60_000,
  });
  const cognitoDomain = config.cognitoDomain.startsWith('http')
    ? config.cognitoDomain
    : `https://${config.cognitoDomain}.auth.${config.awsRegion}.amazoncognito.com`;
  const fn = createAcquireToken({ cognitoDomain, clientSecret, cache, breaker });
  acquireFn = (clientId, scopes) => fn(clientId, scopes);
}

export async function acquireToken(clientId: string, scopes: string[]): Promise<TokenResult> {
  if (!acquireFn) throw new Error('authClient not initialized — call initAuthClient first');
  return acquireFn(clientId, scopes);
}

export async function signDPoP(opts: { accessToken: string; htm: string; htu: string; nonce?: string }): Promise<DPoPProof> {
  return libSignDPoP(opts);
}
