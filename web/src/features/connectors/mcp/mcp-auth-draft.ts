import type { McpServerRow } from './mcp-config-api';
import { createMcpHeaderEntry, type McpHeaderEntry } from './mcp-headers-utils';

export type McpAuthMode = 'auto' | 'oauth' | 'bearer' | 'apiKey' | 'headers' | 'none' | 'existing';
export type McpAuthDraft = {
  mode: McpAuthMode;
  token: string;
  apiKey: string;
  headerName: string;
  customHeaders: McpHeaderEntry[];
  additionalHeaders: McpHeaderEntry[];
};

export function createMcpAuthDraft(row: McpServerRow): McpAuthDraft {
  const headers = row.headers.filter(header => header.key.trim());
  const bearer = headers.find(header => header.key.toLowerCase() === 'authorization' && !header.reference && /^Bearer\s/i.test(header.value));
  const existing = Boolean(row.extra.auth) || headers.some(header => header.reference)
    || Boolean(row.extra.oauth) && headers.some(header => header.key.toLowerCase() === 'authorization');
  const mode = existing ? 'existing' : row.extra.oauth ? 'oauth' : bearer ? 'bearer' : headers.length ? 'headers' : 'auto';
  return {
    mode,
    token: bearer?.value.replace(/^Bearer\s+/i, '') ?? '', apiKey: '', headerName: '',
    customHeaders: headers.length ? headers : [createMcpHeaderEntry()],
    additionalHeaders: mode === 'bearer' ? headers.filter(header => header !== bearer) : mode === 'oauth' ? headers : [],
  };
}

/** Only the selected authentication method is sent; inactive credentials stay in the local draft. */
export function applyMcpAuthDraft(row: McpServerRow, draft: McpAuthDraft): McpServerRow {
  if (row.transport === 'stdio' || draft.mode === 'existing') return { ...row, extra: { ...row.extra } };
  const extra = { ...row.extra };
  delete extra.auth;
  if (draft.mode !== 'oauth') delete extra.oauth;
  let headers = draft.mode === 'headers' ? draft.customHeaders : draft.additionalHeaders;
  if (draft.mode === 'bearer') {
    const token = draft.token.trim().replace(/^Bearer\s+/i, '');
    headers = [...headers, createMcpHeaderEntry('Authorization', `Bearer ${token}`)];
  }
  if (draft.mode === 'apiKey') headers = [...headers, createMcpHeaderEntry(draft.headerName.trim(), draft.apiKey.trim())];
  return { ...row, extra, headers, oauthClientId: draft.mode === 'oauth' ? row.oauthClientId : '' };
}

export function invalidMcpHeaderIndex(headers: McpHeaderEntry[]): number {
  const names = new Set<string>();
  return headers.findIndex(header => {
    const key = header.key.trim();
    if (!key && !header.value && !header.reference) return false;
    if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(key) || /[\r\n]/.test(header.value)) return true;
    const normalized = key.toLowerCase();
    if (names.has(normalized)) return true;
    names.add(normalized);
    return false;
  });
}
