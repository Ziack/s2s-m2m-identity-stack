import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getClientSecret } from '@s2s/auth-library';

export interface ActorCatalogEntry {
  /** Stored as `sha256:<hex>` of the client secret. */
  client_secret_hash: string;
  allowed_audiences: string[];
  allowed_scopes: string[];
}

export interface ActorCatalog {
  /** Returns true if the actor exists and the provided plaintext secret matches its hash. */
  authenticate(actorClientId: string, plaintextSecret: string): boolean;
  /** Returns the catalog entry for an actor, or undefined if unknown. */
  get(actorClientId: string): ActorCatalogEntry | undefined;
  /** All registered actor IDs (for debugging / metrics). */
  list(): string[];
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function parseHashSpec(spec: string): { algo: 'sha256'; hex: string } {
  const [algo, hex] = spec.split(':', 2);
  if (algo !== 'sha256' || !hex || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`unsupported client_secret_hash format: ${spec}`);
  }
  return { algo, hex: hex.toLowerCase() };
}

function constantTimeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function loadActorCatalogFromFile(path: string): ActorCatalog {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return loadActorCatalog(parsed);
}

export interface LoadActorCatalogFromSecretsManagerOptions {
  region?: string;
  /** Override the secret fetcher (tests). */
  fetchSecret?: (arn: string) => Promise<string>;
}

/**
 * Loads the actor catalog from AWS Secrets Manager.
 *
 * The secret value must be a JSON object whose shape matches the file
 * variant — keys are actor client IDs, values are ActorCatalogEntry objects.
 * Use this when the broker is deployed to ECS/EKS and the catalog is stored
 * as a Secrets Manager secret (preferred over baking it into the image).
 */
export async function loadActorCatalogFromSecretsManager(
  secretArn: string,
  opts: LoadActorCatalogFromSecretsManagerOptions = {},
): Promise<ActorCatalog> {
  const raw = opts.fetchSecret
    ? await opts.fetchSecret(secretArn)
    : await getClientSecret(secretArn, opts.region !== undefined ? { region: opts.region } : {});
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return loadActorCatalog(parsed);
}

export function loadActorCatalog(input: Record<string, unknown>): ActorCatalog {
  const entries = new Map<string, ActorCatalogEntry>();
  for (const [actorId, value] of Object.entries(input)) {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`actor catalog entry ${actorId} is not an object`);
    }
    const v = value as Record<string, unknown>;
    const hashSpec = v.client_secret_hash;
    if (typeof hashSpec !== 'string') {
      throw new Error(`actor ${actorId} missing client_secret_hash`);
    }
    // Validate format eagerly so misconfigurations fail at startup.
    parseHashSpec(hashSpec);
    const audiences = Array.isArray(v.allowed_audiences)
      ? v.allowed_audiences.filter((s): s is string => typeof s === 'string')
      : [];
    const scopes = Array.isArray(v.allowed_scopes)
      ? v.allowed_scopes.filter((s): s is string => typeof s === 'string')
      : [];
    entries.set(actorId, {
      client_secret_hash: hashSpec,
      allowed_audiences: audiences,
      allowed_scopes: scopes,
    });
  }

  return {
    authenticate(actorClientId, plaintextSecret) {
      const entry = entries.get(actorClientId);
      if (!entry) return false;
      const parsed = parseHashSpec(entry.client_secret_hash);
      const candidate = sha256Hex(plaintextSecret);
      return constantTimeEqHex(parsed.hex, candidate);
    },
    get(actorClientId) {
      return entries.get(actorClientId);
    },
    list() {
      return Array.from(entries.keys());
    },
  };
}

/** Exported for tests + tooling — produces the `sha256:<hex>` form of a plaintext secret. */
export function hashClientSecret(plaintext: string): string {
  return `sha256:${sha256Hex(plaintext)}`;
}
