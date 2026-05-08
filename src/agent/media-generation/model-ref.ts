/**
 * Capability model-ref parsing — `provider/model` format used by image /
 * audio / video runtimes.
 *
 * Distinct from `src/providers/index.ts#resolveModel` (LLM side, depends on
 * pi-ai). This is a pure string parser with no IO.
 */

export interface ParsedCapabilityModelRef {
  /** Lower-cased provider id. */
  provider: string;
  /** Model id, untouched casing. */
  model: string;
}

/**
 * Parse `"provider/model"` (anything before the first `/`).
 *
 * Returns `null` for missing slashes, empty halves, or non-string input.
 * Surrounding whitespace is trimmed.
 */
export function parseCapabilityModelRef(raw: string | undefined | null): ParsedCapabilityModelRef | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  const provider = trimmed.slice(0, slash).trim().toLowerCase();
  const model = trimmed.slice(slash + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}

/** Compose a `provider/model` ref. Returns `null` if either half is empty. */
export function formatCapabilityModelRef(provider: string, model: string): string | null {
  const p = (provider ?? '').trim().toLowerCase();
  const m = (model ?? '').trim();
  if (!p || !m) return null;
  return `${p}/${m}`;
}
