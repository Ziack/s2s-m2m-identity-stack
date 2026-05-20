import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import { loadSchema, loadPolicyFile, loadAllPolicies } from '../src/loader.js';

export type Decision = 'Allow' | 'Deny';

export interface AuthorizeInput {
  principal: string;          // e.g. 'M2M::ServicePrincipal::"lending-service-client-id"'
  action: string;             // e.g. 'M2M::Action::"POST_loan_application"'
  resource: string;           // e.g. 'M2M::ResourceGroup::"lending-resources"'
  context: Record<string, unknown>;
  entities?: unknown[];
  policyFiles?: string[];     // names without .cedar; defaults to ALL policy files
}

function entityRefToParts(ref: string): { type: string; id: string } {
  // Accepts: M2M::ServicePrincipal::"id"
  const m = ref.match(/^([A-Za-z0-9_:]+)::"([^"]+)"$/);
  if (!m) throw new Error(`bad entity ref: ${ref}`);
  return { type: m[1]!, id: m[2]! };
}

function defaultEntities(input: AuthorizeInput): unknown[] {
  const p = entityRefToParts(input.principal);
  const r = entityRefToParts(input.resource);
  return [
    { uid: { type: p.type, id: p.id }, attrs: { domain: 'unknown' }, parents: [] },
    { uid: { type: r.type, id: r.id }, attrs: { domain: 'unknown' }, parents: [] },
  ];
}

function normalizeDecision(d: string): Decision {
  return d.toLowerCase() === 'allow' ? 'Allow' : 'Deny';
}

export function authorize(input: AuthorizeInput): { decision: Decision; reasons: string[]; errors: string[] } {
  const schema = loadSchema();
  const policiesByFile = input.policyFiles
    ? Object.fromEntries(input.policyFiles.map((n) => [n, loadPolicyFile(n)]))
    : loadAllPolicies();
  const policies = Object.values(policiesByFile).join('\n\n');

  const principalParts = entityRefToParts(input.principal);
  const actionParts = entityRefToParts(input.action);
  const resourceParts = entityRefToParts(input.resource);

  const result = cedar.isAuthorized({
    principal: { type: principalParts.type, id: principalParts.id },
    action: { type: actionParts.type, id: actionParts.id },
    resource: { type: resourceParts.type, id: resourceParts.id },
    context: input.context as cedar.Context,
    policies: { staticPolicies: policies },
    entities: (input.entities ?? defaultEntities(input)) as cedar.Entities,
    schema: schema,
    validateRequest: true,
  });

  if (result.type !== 'success') {
    throw new Error(`cedar-wasm error: ${JSON.stringify(result)}`);
  }
  const resp = result.response;
  return {
    decision: normalizeDecision(resp.decision),
    reasons: resp.diagnostics?.reason ?? [],
    errors: (resp.diagnostics?.errors ?? []).map((e: unknown) => String(e)),
  };
}

export interface UserCtx {
  sub: string;
  roles: string[];
  groups: string[];
}

export function ctx(overrides: Partial<{
  dpop_confirmed: boolean;
  scopes: string[];
  source_domain: string;
  request_hour: number;
  correlation_id: string;
  user: UserCtx;
  actor_chain: string[];
}> = {}): Record<string, unknown> {
  const base = {
    dpop_confirmed: true,
    scopes: ['lending/read', 'lending/write'],
    source_domain: 'lending',
    correlation_id: '00000000-0000-4000-8000-000000000000',
  };
  const merged: Record<string, unknown> = { ...base, ...overrides };
  return merged;
}

// Phase 5 test fixtures — match calling-service hardcoded users.
export const USER_ALICE: UserCtx = {
  sub: 'user-alice',
  roles: ['loan-officer', 'reader'],
  groups: ['retail-banking'],
};
export const USER_BOB: UserCtx = {
  sub: 'user-bob',
  roles: ['auditor', 'reader'],
  groups: ['risk'],
};
export const USER_CAROL: UserCtx = {
  sub: 'user-carol',
  roles: ['reader'],
  groups: ['ops'],
};
