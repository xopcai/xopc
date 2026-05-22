export type McpHeaderEntry = {
  key: string;
  value: string;
};

export function parseHeadersPaste(text: string): McpHeaderEntry[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: value == null ? '' : String(value),
      }));
    }
  } catch {
    // fall through to line parsing
  }

  const rows: McpHeaderEntry[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    const colon = row.indexOf(':');
    if (colon > 0) {
      rows.push({
        key: row.slice(0, colon).trim(),
        value: row.slice(colon + 1).trim(),
      });
      continue;
    }
    const eq = row.indexOf('=');
    if (eq > 0) {
      rows.push({
        key: row.slice(0, eq).trim(),
        value: row.slice(eq + 1).trim(),
      });
    }
  }
  return rows.length > 0 ? rows : null;
}

export function headersToRecord(headers: McpHeaderEntry[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of headers) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = row.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function recordToHeaders(record: Record<string, unknown> | undefined): McpHeaderEntry[] {
  if (!record || typeof record !== 'object') {
    return [{ key: '', value: '' }];
  }
  const rows = Object.entries(record).map(([key, value]) => ({
    key,
    value: value == null ? '' : String(value),
  }));
  return rows.length > 0 ? rows : [{ key: '', value: '' }];
}
