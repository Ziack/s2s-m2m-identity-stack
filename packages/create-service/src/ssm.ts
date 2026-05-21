import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

interface LookupArgs { environment: string; region: string }
interface CacheEntry { contexts: string[]; expiresAt: number }

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function _clearCache(): void { cache.clear(); }

export async function lookupBoundedContexts(args: LookupArgs): Promise<string[] | null> {
  const key = `${args.environment}:${args.region}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.contexts;

  try {
    const client = new SSMClient({ region: args.region });
    const res = await client.send(new GetParameterCommand({
      Name: `/${args.environment}/s2s/platform/bounded_contexts`,
    }));
    const raw = (res as { Parameter?: { Value?: string } }).Parameter?.Value ?? '';
    const contexts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    cache.set(key, { contexts, expiresAt: now + TTL_MS });
    return contexts;
  } catch {
    return null;
  }
}
