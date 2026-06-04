/** Read `primary` from an `AgentModelConfig` object. */
export function agentModelRefToString(ref: unknown): string | undefined {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return undefined;
  const p = (ref as { primary?: string }).primary;
  return typeof p === 'string' && p.trim() ? p : undefined;
}

export function agentModelFallbacksToArray(ref: unknown): string[] {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return [];
  const f = (ref as { fallbacks?: unknown }).fallbacks;
  if (!Array.isArray(f)) return [];
  return f.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/**
 * Coerce a PATCH body `model` value into the canonical `{ primary, fallbacks? }`
 * object form. Returns `undefined` when the input has no usable primary so the
 * caller can skip the assignment.
 */
export function normalizePatchAgentModel(v: unknown): { primary: string; fallbacks?: string[] } | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
  if (!primary) return undefined;
  const fallbacks = Array.isArray(o.fallbacks)
    ? o.fallbacks.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  return fallbacks.length > 0 ? { primary, fallbacks } : { primary };
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
 * PATCH body normalizer for `agents.defaults.imageGenerationModel`. Always
 * emits `{ primary, fallbacks?, timeoutMs?, autoProviderFallback? }`. Returns
 * `undefined` when the input has no usable primary so the caller can skip the
 * assignment.
 */
export function normalizePatchAgentImageGenerationModel(
  v: unknown,
): { primary: string; fallbacks?: string[]; timeoutMs?: number; autoProviderFallback?: true } | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
  if (!primary) return undefined;
  const out: { primary: string; fallbacks?: string[]; timeoutMs?: number; autoProviderFallback?: true } = { primary };
  const fallbacks = Array.isArray(o.fallbacks)
    ? o.fallbacks
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    : [];
  if (fallbacks.length > 0) out.fallbacks = fallbacks;
  if (typeof o.timeoutMs === 'number' && Number.isFinite(o.timeoutMs) && o.timeoutMs > 0) {
    out.timeoutMs = Math.floor(o.timeoutMs);
  }
  if (o.autoProviderFallback === true) out.autoProviderFallback = true;
  return out;
}
