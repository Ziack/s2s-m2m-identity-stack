export interface ValidationResult { ok: boolean; message?: string }

const SERVICE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const BOUNDED_CONTEXT_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SCOPE_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const ALB_PATH_RE = /^\/([a-z0-9-]+(\/[a-z0-9-]+)*\/)?\*$/;
const ENV_RE = /^(dev|staging|prod)$/;

export function validateServiceName(s: string): ValidationResult {
  if (!s || s.length > 63) return { ok: false, message: 'service name must be 1..63 chars' };
  if (!SERVICE_NAME_RE.test(s)) return { ok: false, message: 'DNS-safe lowercase, digits, hyphens (no leading/trailing hyphen)' };
  return { ok: true };
}

export function validateBoundedContext(s: string): ValidationResult {
  if (!s) return { ok: false, message: 'required' };
  if (!BOUNDED_CONTEXT_RE.test(s)) return { ok: false, message: 'lowercase kebab-case' };
  return { ok: true };
}

export function validateScope(s: string): ValidationResult {
  if (!SCOPE_RE.test(s)) return { ok: false, message: 'scope must be <context>/<action> lowercase' };
  return { ok: true };
}

export function validateContainerPort(n: number): ValidationResult {
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { ok: false, message: 'integer in 1..65535' };
  return { ok: true };
}

export function validateAlbPathPattern(s: string): ValidationResult {
  if (!ALB_PATH_RE.test(s)) return { ok: false, message: 'must start with / and end with /* (e.g. /api/foo/*)' };
  return { ok: true };
}

export function validateEnvironment(s: string): ValidationResult {
  if (!ENV_RE.test(s)) return { ok: false, message: 'one of dev|staging|prod' };
  return { ok: true };
}
