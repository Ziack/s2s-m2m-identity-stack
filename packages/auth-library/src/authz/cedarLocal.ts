import type { AuthorizationResult } from '../types.js';

export interface LocalPolicy {
  id: string;
  effect: 'permit' | 'forbid';
  principal?: string;
  action?: string;
  resource?: string;
  whenScopesInclude?: string[];
  unlessScopesInclude?: string[];
  whenContextEquals?: Record<string, unknown>;
}

export interface CedarLocalQuery {
  principal: string;
  action: string;
  resource: string;
  context: { scopes?: string[]; [k: string]: unknown };
}

export interface CedarLocalEngine {
  evaluate(query: CedarLocalQuery): AuthorizationResult;
}

function matches(p: LocalPolicy, q: CedarLocalQuery): boolean {
  if (p.principal && p.principal !== q.principal) return false;
  if (p.action && p.action !== q.action) return false;
  if (p.resource && p.resource !== q.resource) return false;
  const scopes = q.context.scopes ?? [];
  if (p.whenScopesInclude) {
    for (const s of p.whenScopesInclude) if (!scopes.includes(s)) return false;
  }
  if (p.unlessScopesInclude) {
    if (p.unlessScopesInclude.every((s) => scopes.includes(s))) return false;
  }
  if (p.whenContextEquals) {
    for (const [k, v] of Object.entries(p.whenContextEquals)) {
      if (q.context[k] !== v) return false;
    }
  }
  return true;
}

export function createCedarLocal(policies: LocalPolicy[]): CedarLocalEngine {
  return {
    evaluate(q: CedarLocalQuery): AuthorizationResult {
      const start = process.hrtime.bigint();
      const reasons: string[] = [];
      let allow = false;
      let forbid = false;
      for (const p of policies) {
        if (!matches(p, q)) continue;
        reasons.push(p.id);
        if (p.effect === 'forbid') forbid = true;
        else allow = true;
      }
      const decision: 'ALLOW' | 'DENY' = forbid || !allow ? 'DENY' : 'ALLOW';
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      return { decision, reasons, evaluationTimeMs: elapsedMs, mode: 'local' };
    },
  };
}
