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

/** Read `timeoutMs` from an image-generation model ref (only set when ref is an object). */
export function agentImageGenerationModelTimeoutMs(ref: unknown): number | null {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const v = (ref as { timeoutMs?: unknown }).timeoutMs;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Read `autoProviderFallback` from an image-generation model ref. Defaults to false. */
export function agentImageGenerationModelAutoProviderFallback(ref: unknown): boolean {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return false;
  return (ref as { autoProviderFallback?: unknown }).autoProviderFallback === true;
}

/**
 * PATCH body normalizer for `agents.defaults.imageGenerationModel`. Accepts:
 *
 *   - `string` → kept as plain string ref.
 *   - `{ primary, fallbacks?, timeoutMs?, autoProviderFallback? }` → object form.
 *
 * Drops empty/blank values so the persisted config stays clean.
 */
export function normalizePatchAgentImageGenerationModel(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
  const fallbacks = Array.isArray(o.fallbacks)
    ? o.fallbacks
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    : [];
  const out: Record<string, unknown> = {};
  if (primary) out.primary = primary;
  if (fallbacks.length > 0) out.fallbacks = fallbacks;
  if (typeof o.timeoutMs === 'number' && Number.isFinite(o.timeoutMs) && o.timeoutMs > 0) {
    out.timeoutMs = Math.floor(o.timeoutMs);
  }
  if (o.autoProviderFallback === true) out.autoProviderFallback = true;
  // Drop to plain string when no extra knobs are set (matches legacy shape).
  if (Object.keys(out).length === 0) return undefined;
  if (Object.keys(out).length === 1 && typeof out.primary === 'string') return out.primary;
  return out;
}
