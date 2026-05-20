import type { ActorChain } from '../types.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function buildChain(node: Record<string, unknown>): ActorChain | null {
  const sub = node.sub;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  const result: ActorChain = { sub };
  const nested = node.act;
  if (isObject(nested)) {
    const child = buildChain(nested);
    if (child) result.act = child;
  }
  return result;
}

/**
 * Walks the RFC 8693 `act` claim recursively, returning a structured ActorChain
 * representing every hop above the principal `sub` (innermost actor first → outermost wrapper).
 *
 * Returns `null` if the top-level `act` claim is missing or malformed (non-object, missing `sub`).
 * Malformed nested `act` entries are silently truncated — the chain stops at the last valid hop.
 */
export function extractActorChain(claims: Record<string, unknown>): ActorChain | null {
  const act = claims.act;
  if (!isObject(act)) return null;
  return buildChain(act);
}
