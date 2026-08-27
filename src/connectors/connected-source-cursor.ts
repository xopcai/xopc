export type ConnectedSourceCursor = {
  version: 1;
  checkpoint?: string;
  scanStartedAt?: string;
  pageToken?: string;
  syncToken?: string;
};

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function decodeConnectedSourceCursor(value: string | undefined): ConnectedSourceCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const row = parsed as Record<string, unknown>;
    if (row.version !== 1) return undefined;
    return {
      version: 1,
      ...(optionalText(row.checkpoint) ? { checkpoint: optionalText(row.checkpoint) } : {}),
      ...(optionalText(row.scanStartedAt) ? { scanStartedAt: optionalText(row.scanStartedAt) } : {}),
      ...(optionalText(row.pageToken) ? { pageToken: optionalText(row.pageToken) } : {}),
      ...(optionalText(row.syncToken) ? { syncToken: optionalText(row.syncToken) } : {}),
    };
  } catch {
    return undefined;
  }
}

export function encodeConnectedSourceCursor(cursor: Omit<ConnectedSourceCursor, 'version'>): string {
  return JSON.stringify({ version: 1, ...cursor });
}
