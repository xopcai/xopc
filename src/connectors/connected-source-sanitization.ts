const SENSITIVE_KEY_RE = /(?:^|_)(?:api_?key|token|secret|password|passwd|authorization|credential|private_?key)(?:$|_)/i;
const INLINE_SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function sanitizeConnectedSourceValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[MaxDepth]';
  if (typeof value === 'string') {
    return INLINE_SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeConnectedSourceValue(item, depth + 1));
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(Object.entries(source).map(([key, nested]) => [
    key,
    SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitizeConnectedSourceValue(nested, depth + 1),
  ]));
}
