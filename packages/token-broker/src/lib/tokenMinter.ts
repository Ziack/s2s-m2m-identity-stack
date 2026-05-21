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
