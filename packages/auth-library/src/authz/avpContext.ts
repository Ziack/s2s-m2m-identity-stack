/**
 * Encode a plain JS context map into the AWS Verified Permissions
 * `AttributeValue` union form required by `IsAuthorized` / `IsAuthorizedWithToken`.
 * AVP rejects raw JS values — every leaf must be wrapped as `{boolean}`,
 * `{string}`, `{long}`, `{set}` or `{record}`.
 */
export type AvpAttributeValue =
  | { boolean: boolean }
  | { string: string }
  | { long: number }
  | { set: AvpAttributeValue[] }
  | { record: Record<string, AvpAttributeValue> };

function encodeValue(value: unknown): AvpAttributeValue {
  if (typeof value === 'boolean') return { boolean: value };
  if (typeof value === 'string') return { string: value };
  if (typeof value === 'number' && Number.isFinite(value)) return { long: value };
  if (Array.isArray(value)) return { set: value.map(encodeValue) };
  if (value !== null && typeof value === 'object') {
    return { record: encodeRecord(value as Record<string, unknown>) };
  }
  throw new Error(`toAvpContextMap: unsupported context value type: ${typeof value} (${String(value)})`);
}

function encodeRecord(obj: Record<string, unknown>): Record<string, AvpAttributeValue> {
  const out: Record<string, AvpAttributeValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = encodeValue(v);
  }
  return out;
}

export function toAvpContextMap(context: Record<string, unknown>): Record<string, AvpAttributeValue> {
  return encodeRecord(context);
}
