import { normalizeLowercaseStringOrEmpty } from '../../utils/string-coerce.js';

const TOOL_NAME_SAFE_RE = /[^A-Za-z0-9_-]/g;
const TOOL_NAME_MAX_PREFIX = 30;

function sanitizeToolFragment(raw: string, fallback: string, maxChars?: number): string {
  const cleaned = raw.trim().replace(TOOL_NAME_SAFE_RE, "-");
  const normalized = cleaned || fallback;
  if (!maxChars) {
    return normalized;
  }
  return normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
}

export function sanitizeServerName(raw: string, usedNames: Set<string>): string {
  const base = sanitizeToolFragment(raw, "mcp", TOOL_NAME_MAX_PREFIX);
  let candidate = base;
  let n = 2;
  while (usedNames.has(normalizeLowercaseStringOrEmpty(candidate))) {
    const suffix = `-${n}`;
    candidate = `${base.slice(0, Math.max(1, TOOL_NAME_MAX_PREFIX - suffix.length))}${suffix}`;
    n += 1;
  }
  usedNames.add(normalizeLowercaseStringOrEmpty(candidate));
  return candidate;
}
