export type McpHeaderEntry = {
  clientKey: string;
  key: string;
  value: string;
  reference?: Record<string, unknown>;
};

export function createMcpHeaderEntry(key = '', value = ''): McpHeaderEntry {
  return { clientKey: crypto.randomUUID(), key, value };
}

const MCP_HEADER_LINE = /^([^:=]+)[:=](.*)$/;

export function parseHeadersPaste(text: string): McpHeaderEntry[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return recordToHeaders(parsed as Record<string, unknown>);
    }
  } catch {
    // fall through to line parsing
  }

  const rows: McpHeaderEntry[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    const match = MCP_HEADER_LINE.exec(row);
    if (!match) continue;
    rows.push(createMcpHeaderEntry(match[1].trim(), match[2].trim()));
  }
  return rows.length > 0 ? rows : null;
}

export function headersToRecord(headers: McpHeaderEntry[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = Object.create(null);
  for (const row of headers) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = row.reference ?? row.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function recordToHeaders(record: Record<string, unknown> | undefined): McpHeaderEntry[] {
  if (!record || typeof record !== 'object') {
    return [createMcpHeaderEntry()];
  }
  const rows = Object.entries(record).map(([key, value]) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ...createMcpHeaderEntry(key), reference: value as Record<string, unknown> }
      : createMcpHeaderEntry(key, value == null ? '' : String(value)),
  );
  return rows.length > 0 ? rows : [createMcpHeaderEntry()];
}
