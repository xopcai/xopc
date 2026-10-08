const SECRET_KEY = /authorization|api.?key|password|secret|access.?token|refresh.?token|bot.?token|cookie/i;
const OMIT_KEY = /^(data|base64|headers|image_url|audio|video)$/i;
export function redactString(value: string): string {
  return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|pk-lf-|sk-lf-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/data:[^\s"']+;base64,[^\s"']+/gi, '[MEDIA OMITTED]');
}
/** Bounds traversal before serializing; never materializes an entire tool/file payload. */
export function boundedJson(value: unknown, maxBytes = 8192): string {
  const seen = new WeakSet<object>();
  let budget = Math.max(64, maxBytes - 256);
  let truncated = false;
  const walk = (v: unknown, depth: number): unknown => {
    if (budget < 32 || depth > 5) { truncated = true; return '[TRUNCATED]'; }
    if (v === null || typeof v === 'number' || typeof v === 'boolean') { budget -= 16; return v; }
    if (typeof v === 'string') {
      const slice = v.slice(0, Math.min(budget, 4096));
      const clean = redactString(slice);
      const buf = Buffer.from(clean);
      const size = Math.min(budget, 4096);
      budget -= Math.min(buf.length, size);
      if (slice.length < v.length || buf.length > size) truncated = true;
      return buf.subarray(0, size).toString('utf8');
    }
    if (typeof v !== 'object') return undefined;
    if (seen.has(v)) return '[CIRCULAR]';
    seen.add(v);
    if (Array.isArray(v)) {
      const values = [];
      for (let i = 0; i < Math.min(v.length, 40) && budget > 32; i++) values.push(walk(v[i], depth + 1));
      if (values.length < v.length) truncated = true;
      return values;
    }
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const key in v) {
      if (!Object.hasOwn(v, key)) continue;
      if (++count > 40 || budget < 32) { truncated = true; break; }
      const safeKey = key.slice(0, 80);
      budget -= Buffer.byteLength(safeKey) + 8;
      try {
        result[safeKey] = SECRET_KEY.test(key) ? '[REDACTED]' : OMIT_KEY.test(key) ? '[OMITTED]' : walk(v[key], depth + 1);
      } catch { result[safeKey] = '[UNAVAILABLE]'; }
    }
    return result;
  };
  let data: unknown;
  try { data = walk(value, 0); } catch { data = '[UNAVAILABLE]'; }
  const text = JSON.stringify({ preview: data, truncated });
  if (Buffer.byteLength(text) <= maxBytes) return text;
  return JSON.stringify({ preview: Buffer.from(redactString(text)).subarray(0, Math.floor(maxBytes / 8)).toString('utf8'), truncated: true });
}
