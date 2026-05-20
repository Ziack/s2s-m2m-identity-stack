/**
 * Hardcoded test users for the local IdP PoC.
 *
 * This module is deliberately tiny and self-contained — when Keycloak (or any
 * real OIDC provider) takes over, this file (along with `localIssuer.ts` and
 * `userIssuerKeyLoader.ts`) is the only thing that needs to be deleted. The
 * SDK and routes do not depend on the in-memory user table.
 *
 * Passwords are SHA-256 hashed at module-load time so plaintext credentials
 * never linger in memory. Use `verifyPassword()` for constant-time compares.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export interface TestUser {
  sub: string;
  /** SHA-256 hex digest of the plaintext password. */
  passwordHash: string;
  roles: string[];
  groups: string[];
}

function sha256Hex(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

/**
 * Build the in-memory user table. Exposed as a function (rather than a
 * top-level frozen constant) so tests can rebuild fresh tables if needed,
 * but the default singleton is constructed once at module load.
 */
function buildTable(): Map<string, TestUser> {
  const entries: Array<[string, Omit<TestUser, 'passwordHash'> & { password: string }]> = [
    [
      'alice',
      {
        sub: 'user-alice',
        password: 'alice-pw',
        roles: ['loan-officer', 'reader'],
        groups: ['retail-banking'],
      },
    ],
    [
      'bob',
      {
        sub: 'user-bob',
        password: 'bob-pw',
        roles: ['auditor', 'reader'],
        groups: ['risk'],
      },
    ],
    [
      'carol',
      {
        sub: 'user-carol',
        password: 'carol-pw',
        roles: ['reader'],
        groups: ['ops'],
      },
    ],
  ];
  const m = new Map<string, TestUser>();
  for (const [username, e] of entries) {
    m.set(username, {
      sub: e.sub,
      passwordHash: sha256Hex(e.password),
      roles: e.roles,
      groups: e.groups,
    });
  }
  return m;
}

export const TEST_USERS: ReadonlyMap<string, TestUser> = buildTable();

/**
 * Constant-time password check.
 *
 * Returns `true` only when the username exists and the SHA-256 of the
 * provided plaintext matches the stored hash. Length-safe: a `timingSafeEqual`
 * call requires equal-length buffers, so we compare hex digests of fixed
 * length (64 chars for SHA-256).
 */
export function verifyPassword(username: string, plaintext: string): boolean {
  const user = TEST_USERS.get(username);
  if (!user) return false;
  const candidate = sha256Hex(plaintext);
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(user.passwordHash, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Dev-only helper: list usernames with their roles. NEVER expose passwords. */
export function listTestUsers(): Array<{ username: string; sub: string; roles: string[]; groups: string[] }> {
  const out: Array<{ username: string; sub: string; roles: string[]; groups: string[] }> = [];
  for (const [username, u] of TEST_USERS) {
    out.push({ username, sub: u.sub, roles: u.roles, groups: u.groups });
  }
  return out;
}
