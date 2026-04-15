/** Normalize agent model ref (string | `{ primary }`) for API clients. */
export function agentModelRefToString(ref: unknown): string | undefined {
  if (ref === undefined || ref === null) return undefined;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && ref !== null && 'primary' in ref) {
    const p = (ref as { primary?: string }).primary;
    return typeof p === 'string' ? p : undefined;
  }
  return undefined;
}

export function agentModelFallbacksToArray(ref: unknown): string[] {
  if (typeof ref !== 'object' || ref === null || !('fallbacks' in ref)) {
    return [];
  }
  const f = (ref as { fallbacks?: unknown }).fallbacks;
  if (!Array.isArray(f)) {
    return [];
  }
  return f.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/**
 * Accept string or `{ primary, fallbacks? }` from PATCH body; coerce to schema-friendly shape.
 */
export function normalizePatchAgentModel(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (typeof v === 'string') {
    return v;
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
    const fallbacks = Array.isArray(o.fallbacks)
      ? o.fallbacks.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    if (primary && fallbacks.length > 0) {
      return { primary, fallbacks };
    }
    if (primary) {
      return primary;
    }
  }
  return v;
}
