import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import {
  headersToRecord,
  recordToHeaders,
  type McpHeaderEntry,
} from '@/features/connectors/mcp/mcp-headers-utils';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type McpTransportKind = 'stdio' | 'streamable-http';
export type McpServerRow = {
  clientKey: string; id: string; displayName?: string; transport: McpTransportKind;
  command: string; argsText: string; envJson: string; cwd: string; url: string;
  headers: McpHeaderEntry[]; envEntries?: McpHeaderEntry[]; oauthClientId: string; timeout: number | undefined;
  exposure: 'codemode' | 'deferred' | 'direct' | 'hidden';
  extra: Record<string, unknown>;
};
export type McpSettingsState = { servers: McpServerRow[] };

export function isManagedConnectorServerConfig(server: unknown): boolean {
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    return false;
  }
  const marker = (server as Record<string, unknown>).xopcConnector;
  return Boolean(
    marker &&
      typeof marker === 'object' &&
      !Array.isArray(marker) &&
      (marker as Record<string, unknown>).managed === true,
  );
}

export function extractManagedMcpServers(cfg: unknown): Record<string, Record<string, unknown>> {
  const mcp =
    cfg && typeof cfg === 'object' && 'mcp' in cfg ? (cfg as { mcp?: unknown }).mcp : undefined;
  const root = mcp && typeof mcp === 'object' ? (mcp as Record<string, unknown>) : {};
  const serversRaw = root.servers;
  const managed: Record<string, Record<string, unknown>> = {};
  if (!serversRaw || typeof serversRaw !== 'object' || Array.isArray(serversRaw)) {
    return managed;
  }
  for (const [id, value] of Object.entries(serversRaw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (isManagedConnectorServerConfig(value)) {
      managed[id] = value as Record<string, unknown>;
    }
  }
  return managed;
}

export function parseArgsText(text: string): string[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('[')) {
    const args = JSON.parse(trimmed);
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw new Error('Command arguments must be a JSON array of strings.');
    return args;
  }
  const args: string[] = [];
  let value = '', quote = '', started = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '\\' && trimmed[i + 1] && quote !== "'" && /[\s"'\\]/.test(trimmed[i + 1])) { value += trimmed[++i]; started = true; }
    else if (quote) { if (char === quote) quote = ''; else value += char; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { args.push(value); value = ''; started = false; } }
    else { value += char; started = true; }
  }
  if (quote) throw new Error('Command arguments contain an unclosed quote.');
  if (started) args.push(value);
  return args;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function rowToServerConfig(row: McpServerRow): Record<string, unknown> {
  const config: Record<string, unknown> = { ...row.extra, exposure: row.exposure };
  if (row.displayName?.trim()) config.displayName = row.displayName.trim(); else delete config.displayName;
  delete config.command; delete config.args; delete config.env; delete config.cwd;
  delete config.url; delete config.headers; delete config.type;
  if (row.transport === 'stdio') {
    config.type = 'stdio'; config.command = row.command.trim();
    const args = parseArgsText(row.argsText); if (args) config.args = args;
    if (row.cwd.trim()) config.cwd = row.cwd.trim();
    if (row.envEntries) {
      const names = new Set<string>();
      for (const entry of row.envEntries) {
        if (!entry.key.trim() && !entry.value && !entry.reference) continue;
        if (!entry.key.trim() || names.has(entry.key.trim())) throw new Error('Environment variable names must be non-empty and unique.');
        names.add(entry.key.trim());
      }
      const env = headersToRecord(row.envEntries); if (env) config.env = env;
    } else if (row.envJson.trim()) config.env = parseJsonObject(row.envJson);
    delete config.oauth; delete config.auth;
  } else {
    config.type = 'http'; config.url = row.url.trim();
    const headers = headersToRecord(row.headers); if (headers) config.headers = headers;
    const oauth = { ...(config.oauth as Record<string, unknown> ?? {}) };
    if (row.oauthClientId.trim()) oauth.clientId = row.oauthClientId.trim(); else delete oauth.clientId;
    if (Object.keys(oauth).length) config.oauth = oauth; else delete config.oauth;
  }
  if (row.timeout !== undefined) config.timeout = row.timeout; else delete config.timeout;
  return config;
}
function serverConfigToRow(id: string, raw: Record<string, unknown>): McpServerRow {
  const oauth = raw.oauth as Record<string, unknown> | undefined;
  return { clientKey: id, id, displayName: typeof raw.displayName === 'string' ? raw.displayName : '', transport: typeof raw.url === 'string' ? 'streamable-http' : 'stdio',
    command: typeof raw.command === 'string' ? raw.command : '', argsText: Array.isArray(raw.args) ? JSON.stringify(raw.args) : '',
    envJson: raw.env ? JSON.stringify(raw.env, null, 2) : '', cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    url: typeof raw.url === 'string' ? raw.url : '', headers: recordToHeaders(raw.headers as Record<string, unknown> | undefined),
    oauthClientId: typeof oauth?.clientId === 'string' ? oauth.clientId : '',
    timeout: typeof raw.timeout === 'number' ? raw.timeout : undefined,
    exposure: (raw.exposure as McpServerRow['exposure']) ?? 'codemode', extra: raw,
  };
}

export function suggestMcpServerId(row: McpServerRow, occupied: ReadonlySet<string>): string {
  let name = 'mcp';
  try { name = row.transport === 'streamable-http' ? new URL(row.url).hostname : row.command.split(/[\\/]/).pop() || name; } catch { /* The URL is validated when connecting. */ }
  const base = name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
  const used = new Set([...occupied].map(id => id.replace(/-/g, '_')));
  let id = base;
  for (let index = 2; used.has(id.replace(/-/g, '_')); index++) id = `${base}_${index}`;
  return id;
}

export function normalizeMcpAddress(value: string): string {
  const input = value.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[^/]+:\d+(?:[/?#]|$)/.test(input)
    ? input : `${/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(input) ? 'http' : 'https'}://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS MCP address without embedded credentials.');
  return url.href;
}

export function parseMcpConfigImport(text: string): McpServerRow[] {
  const input = JSON.parse(text);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a JSON object.');
  const configs = input.mcpServers ?? input.mcp?.servers ?? input.servers;
  if (configs !== undefined && (!configs || typeof configs !== 'object' || Array.isArray(configs))) throw new Error('Expected a server configuration object.');
  const entries: Array<[string, unknown]> = configs ? Object.entries(configs) : [['', input]];
  if (!entries.length) throw new Error('No MCP servers found.');
  return entries.map(([id, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP server configuration.');
    const raw = value as Record<string, unknown>;
    if (typeof raw.url !== 'string' && typeof raw.command !== 'string') throw new Error('The configuration needs an MCP URL or command.');
    if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some(arg => typeof arg !== 'string'))) throw new Error('Command arguments must be strings.');
    const row = serverConfigToRow(id, raw);
    row.clientKey = crypto.randomUUID();
    if (row.url) row.url = normalizeMcpAddress(row.url);
    return row;
  });
}
export function emptyMcpServerRow(id = ''): McpServerRow {
  return { clientKey: crypto.randomUUID(), id, transport: 'streamable-http', command: '', argsText: '', envJson: '', cwd: '',
    url: '', headers: [], oauthClientId: '', timeout: undefined, exposure: 'codemode', extra: {} };
}
export function normalizeMcpSettingsFromConfig(cfg: unknown): McpSettingsState {
  const servers = (cfg as { mcp?: { servers?: Record<string, Record<string, unknown>> } } | undefined)?.mcp?.servers ?? {};
  return { servers: Object.entries(servers).filter(([, raw]) => !isManagedConnectorServerConfig(raw))
    .map(([id, raw]) => serverConfigToRow(id, raw)).sort((a, b) => a.id.localeCompare(b.id)) };
}
export function buildMcpServerConfigFromRow(row: McpServerRow): Record<string, unknown> { return rowToServerConfig(row); }
export async function patchMcpSettings(state: McpSettingsState, managedServers: Record<string, Record<string, unknown>> = {}): Promise<void> {
  const servers: Record<string, Record<string, unknown>> = Object.assign(Object.create(null), managedServers);
  for (const row of state.servers) {
    const id = row.id.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('MCP IDs require letters, digits, underscores or hyphens.');
    if (managedServers[id]) throw new Error(`Server id "${id}" is reserved by an installed connector.`);
    servers[id] = rowToServerConfig(row);
  }
  await fetchJson(apiUrl('/api/config'), { method: 'PATCH', body: JSON.stringify({ mcp: { servers } }) });
  void revalidateGatewayConfig();
}

export function mcpServerCardKey(row: McpServerRow, _index: number): string {
  return row.clientKey;
}

export type McpToolInfo = { name: string; description: string; inputSchema: unknown; exposure?: string };
export async function fetchMcpTools(serverId: string, signal: AbortSignal): Promise<McpToolInfo[]> {
  const result = await fetchJson<{ ok: boolean; payload: { tools: McpToolInfo[] } }>(
    apiUrl(`/api/mcp/servers/${encodeURIComponent(serverId)}/tools`),
    { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(95_000)]) },
  );
  return result.payload.tools;
}

export type McpConnectionProbe = { state: 'connected' | 'oauth_required' | 'token_required' | 'error'; toolCount?: number; error?: string };
export type McpAuthorization = { id: string; serverId: string; state: 'starting' | 'authorizing' | 'connected' | 'error' | 'cancelled';
  authorizationUrl?: string; acceptsRedirect?: boolean; toolCount?: number; error?: string };
export async function probeMcpServer(serverId: string, signal: AbortSignal): Promise<McpConnectionProbe> {
  const result = await fetchJson<{ payload: McpConnectionProbe }>(apiUrl(`/api/mcp/servers/${encodeURIComponent(serverId)}/probe`),
    { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(95_000)]) });
  return result.payload;
}
export async function startMcpSignIn(serverId: string): Promise<McpAuthorization> {
  const result = await fetchJson<{ payload: McpAuthorization }>(apiUrl(`/api/mcp/servers/${encodeURIComponent(serverId)}/auth`), { method: 'POST' });
  return result.payload;
}
export async function readMcpSignIn(id: string, signal: AbortSignal): Promise<McpAuthorization> {
  const result = await fetchJson<{ payload: McpAuthorization }>(apiUrl(`/api/mcp/auth/${encodeURIComponent(id)}`), { signal });
  return result.payload;
}
export async function cancelMcpSignIn(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/mcp/auth/${encodeURIComponent(id)}`), { method: 'DELETE' });
}
export async function submitMcpSignInRedirect(id: string, url: string): Promise<void> {
  await fetchJson(apiUrl(`/api/mcp/auth/${encodeURIComponent(id)}/redirect`), { method: 'POST', body: JSON.stringify({ url }) });
}

export type McpConnectionDraft = { id: string; serverId: string; expiresAt: number };
export async function createMcpConnectionDraft(row: McpServerRow, sourceServerId: string | undefined, expectedServer: unknown, signal: AbortSignal): Promise<McpConnectionDraft> {
  const result = await fetchJson<{ payload: McpConnectionDraft }>(apiUrl('/api/mcp/drafts'), {
    method: 'POST', signal, body: JSON.stringify({ serverId: row.id, sourceServerId, expectedServer, server: rowToServerConfig(row) }),
  });
  return result.payload;
}
export async function probeMcpDraft(id: string, signal: AbortSignal): Promise<McpConnectionProbe> {
  const result = await fetchJson<{ payload: McpConnectionProbe }>(apiUrl(`/api/mcp/drafts/${encodeURIComponent(id)}/probe`), {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(95_000)]),
  });
  return result.payload;
}
export async function deleteMcpDraft(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/mcp/drafts/${encodeURIComponent(id)}`), { method: 'DELETE' });
}
export async function commitMcpDraft(id: string, enable = false): Promise<{ serverId: string; reloadRequired?: boolean }> {
  const result = await fetchJson<{ payload: { serverId: string; reloadRequired?: boolean } }>(apiUrl(`/api/mcp/drafts/${encodeURIComponent(id)}/commit`), { method: 'POST', body: JSON.stringify({ enable }) });
  void revalidateGatewayConfig();
  return result.payload;
}
export async function startMcpDraftSignIn(id: string): Promise<McpAuthorization> {
  const result = await fetchJson<{ payload: McpAuthorization }>(apiUrl(`/api/mcp/drafts/${encodeURIComponent(id)}/auth`), { method: 'POST' });
  return result.payload;
}
export async function readMcpDraftSignIn(id: string, signal: AbortSignal): Promise<McpAuthorization> {
  const result = await fetchJson<{ payload: McpAuthorization }>(apiUrl(`/api/mcp/drafts/${encodeURIComponent(id)}/auth`), { signal });
  return result.payload;
}
export async function cancelMcpDraftSignIn(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/mcp/drafts/${encodeURIComponent(id)}/auth`), { method: 'DELETE' });
}
export async function submitMcpDraftRedirect(id: string, url: string): Promise<void> {
  await fetchJson(apiUrl(`/api/mcp/drafts/${encodeURIComponent(id)}/auth/redirect`), { method: 'POST', body: JSON.stringify({ url }) });
}
export async function fetchMcpDraftTools(id: string, signal: AbortSignal): Promise<McpToolInfo[]> {
  const result = await fetchJson<{ payload: { tools: McpToolInfo[] } }>(apiUrl(`/api/mcp/drafts/${encodeURIComponent(id)}/tools`), { signal });
  return result.payload.tools;
}

export type McpLastCheck = { checkedAt: string; toolCount: number };
export async function fetchMcpConnectionChecks(signal: AbortSignal): Promise<Record<string, McpLastCheck>> {
  const result = await fetchJson<{ payload: { servers: Array<{ id: string; lastCheck?: McpLastCheck }> } }>(apiUrl('/api/mcp/servers'), { signal });
  return Object.fromEntries(result.payload.servers.filter(item => item.lastCheck && Number.isFinite(Date.parse(item.lastCheck.checkedAt)))
    .map(item => [item.id, item.lastCheck!]));
}

/** Delete only this version of this entry; never replace the client's stale full server collection. */
export async function deleteMcpServer(row: McpServerRow): Promise<{ reloadRequired?: boolean }> {
  const result = await fetchJson<{ payload: { reloadRequired?: boolean } }>(apiUrl(`/api/mcp/servers/${encodeURIComponent(row.id)}`), {
    method: 'DELETE', body: JSON.stringify({ expectedServer: row.extra }),
  });
  void revalidateGatewayConfig();
  return result.payload;
}
