export const BOUNDED_CONTEXTS = [
  'lending',
  'deposits',
  'payments',
  'fraud',
  'notifications',
  'accounts',
] as const;

export type BoundedContext = (typeof BOUNDED_CONTEXTS)[number];

export const SCOPES_PER_CONTEXT: Record<BoundedContext, { name: string; description: string }[]> = {
  lending:       [{ name: 'read', description: 'Read lending resources' },       { name: 'write', description: 'Write lending resources' }],
  deposits:      [{ name: 'read', description: 'Read deposits resources' },      { name: 'write', description: 'Write deposits resources' }],
  payments:      [{ name: 'read', description: 'Read payments resources' },      { name: 'write', description: 'Write payments resources' }],
  fraud:         [{ name: 'read', description: 'Read fraud resources' },         { name: 'write', description: 'Write fraud resources' }],
  notifications: [{ name: 'read', description: 'Read notifications resources' }, { name: 'write', description: 'Write notifications resources' }],
  accounts:      [{ name: 'read', description: 'Read accounts resources' },      { name: 'write', description: 'Write accounts resources' }],
};

export function pascal(ctx: BoundedContext): string {
  return ctx.charAt(0).toUpperCase() + ctx.slice(1);
}
