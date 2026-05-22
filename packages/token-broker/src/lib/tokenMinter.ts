import { signUserJwt } from '@s2s/auth-library';
import type { KeyLike } from 'jose';
import type { ActorChain, UserContext } from '@s2s/auth-library';

export interface MintExchangedTokenOptions {
  privateKey: KeyLike;
  kid: string;
  issuer: string;
  ttlSeconds: number;
}

export interface MintExchangedTokenInput {
  user: UserContext;
  audience: string;
  scopes: string[];
  actorClientId: string;
  previousActorChain: ActorChain | null;
  /**
   * base64url SHA-256 JWK thumbprint of the CURRENT exchange request's DPoP
   * proof key. Emitted as `cnf: { jkt }` (RFC 9449 §6 sender constraint). This
   * always binds to the key on the present hop's proof — when a service
   * re-exchanges an inbound cnf-bound token, the new token re-binds to the
   * re-exchanging service's key, not the inbound token's cnf.
   */
  confirmationJkt: string;
  nowFn?: () => number;
}

/** Composes a new RFC8693 `act` chain by wrapping the previous one (innermost = caller). */
export function composeActorChain(actorClientId: string, previous: ActorChain | null): ActorChain {
  const chain: ActorChain = { sub: actorClientId };
  if (previous) chain.act = previous;
  return chain;
}

export async function mintExchangedToken(
  opts: MintExchangedTokenOptions,
  input: MintExchangedTokenInput,
): Promise<string> {
  const act = composeActorChain(input.actorClientId, input.previousActorChain);
  const customClaims: Record<string, unknown> = {
    act,
    scope: input.scopes.join(' '),
    user_issuer: input.user.issuer,
    // RFC 9449 §6 sender constraint, bound to this hop's proof key.
    cnf: { jkt: input.confirmationJkt },
  };
  const signOpts: Parameters<typeof signUserJwt>[0] = {
    privateKey: opts.privateKey,
    kid: opts.kid,
    issuer: opts.issuer,
    audience: input.audience,
    ttlSeconds: opts.ttlSeconds,
  };
  const signInput: Parameters<typeof signUserJwt>[1] = {
    sub: input.user.sub,
    roles: input.user.roles,
    groups: input.user.groups,
    customClaims,
  };
  if (input.nowFn) signInput.nowFn = input.nowFn;
  return signUserJwt(signOpts, signInput);
}
