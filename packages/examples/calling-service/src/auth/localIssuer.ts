/**
 * Local IdP shim. Issues user JWTs against the in-memory test-user table,
 * signed by the user-issuer RSA key. This is a PoC stand-in for a real IdP
 * (Keycloak) — disappears entirely when the real provider is in place.
 */
import { AuthError, ERROR_CODES, signUserJwt } from '@s2s/auth-library';
import { TEST_USERS, verifyPassword } from './testUsers.js';
import type { UserIssuerKeyLoader } from './userIssuerKeyLoader.js';

export interface LocalIssuerOptions {
  issuer: string;
  audience: string;
  keyLoader: UserIssuerKeyLoader;
  /** Token TTL in seconds. Default 900. */
  ttlSeconds?: number;
}

export interface IssueUserTokenInput {
  username: string;
  password: string;
}

export interface IssueUserTokenResult {
  user_token: string;
  expires_in: number;
  sub: string;
  roles: string[];
}

export interface LocalIssuer {
  issueUserToken(input: IssueUserTokenInput): Promise<IssueUserTokenResult>;
}

export function createLocalIssuer(opts: LocalIssuerOptions): LocalIssuer {
  const ttl = opts.ttlSeconds ?? 900;
  return {
    async issueUserToken(input: IssueUserTokenInput): Promise<IssueUserTokenResult> {
      const user = TEST_USERS.get(input.username);
      const ok = user ? verifyPassword(input.username, input.password) : false;
      if (!user || !ok) {
        throw new AuthError(401, ERROR_CODES.INVALID_TOKEN, 'invalid_credentials');
      }
      const key = await opts.keyLoader.get();
      const token = await signUserJwt(
        {
          issuer: opts.issuer,
          audience: opts.audience,
          kid: key.kid,
          privateKey: key.privateKey,
          ttlSeconds: ttl,
        },
        { sub: user.sub, roles: user.roles, groups: user.groups },
      );
      return {
        user_token: token,
        expires_in: ttl,
        sub: user.sub,
        roles: user.roles,
      };
    },
  };
}
