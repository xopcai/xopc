/**
 * Infer the intended type of a config value from its raw string representation.
 * Mirrors openclaw-style parseConfigValue behavior.
 */

export type ParsedConfigValue =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function parseConfigValue(raw: string): ParsedConfigValue {
  const trimmed = raw.trim();

  if (trimmed === 'true') return { ok: true, value: true };
  if (trimmed === 'false') return { ok: true, value: false };
  if (trimmed === 'null') return { ok: true, value: null };

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return { ok: true, value: num };
  }

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: false, error: 'Invalid JSON value.' };
    }
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: false, error: 'Invalid quoted string.' };
    }
  }

  return { ok: true, value: trimmed };
}
