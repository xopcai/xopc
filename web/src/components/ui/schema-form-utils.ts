import type { JsonSchema } from '@/components/ui/schema-form';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Extract per-key defaults from a JSON object schema for "Reset" actions. */
export function extractObjectDefaults(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type !== 'object' || !isRecord(schema.properties)) {
    return out;
  }
  for (const [k, sub] of Object.entries(schema.properties)) {
    if (!isRecord(sub)) continue;
    if (Object.prototype.hasOwnProperty.call(sub, 'default')) {
      out[k] = sub.default;
    }
  }
  return out;
}
