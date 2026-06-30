import type { AgentTypedModel } from '../../../config/schema.js';

const TYPED_MODEL_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

function isValidProviderModelRef(ref: string): boolean {
  const trimmed = ref.trim();
  const idx = trimmed.indexOf('/');
  return idx > 0 && idx < trimmed.length - 1;
}

/**
 * Coerce PATCH body `{ roles: Record<id, role> }` into validated typed model roles.
 * Returns `null` to clear, `undefined` when input should be skipped, or cleaned roles.
 * Empty roles after filtering → `null` (same as clear).
 */
export function normalizePatchTypedModels(
  v: unknown,
): Record<string, Omit<AgentTypedModel, 'id'>> | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || !('roles' in v)) return undefined;
  const rawRoles = (v as { roles?: unknown }).roles;
  if (!rawRoles || typeof rawRoles !== 'object' || Array.isArray(rawRoles)) return undefined;
  const rows = Object.entries(rawRoles).map(([id, role]) => ({ id, ...(role as object) }));

  const byId = new Map<string, Omit<AgentTypedModel, 'id'>>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const model = typeof o.model === 'string' ? o.model.trim() : '';
    if (!id || !TYPED_MODEL_ID_RE.test(id) || !model || !isValidProviderModelRef(model)) continue;
    const description =
      typeof o.description === 'string' && o.description.trim()
        ? o.description.trim().slice(0, 500)
        : undefined;
    byId.set(id, description ? { description, model } : { model });
  }

  if (byId.size === 0) return null;
  return Object.fromEntries(byId.entries());
}

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
 * PATCH body normalizer for image-generation model refs. Always
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
