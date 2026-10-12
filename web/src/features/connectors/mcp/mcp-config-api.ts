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
  clientKey: string; id: string; transport: McpTransportKind;
  command: string; argsText: string; envJson: string; cwd: string; url: string;
  headers: McpHeaderEntry[]; oauthClientId: string; timeout: number | undefined;
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

function parseArgsText(text: string): string[] | undefined {
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
    if (char === '\\' && trimmed[i + 1] && quote !== "'") { value += trimmed[++i]; started = true; }
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
  delete config.command; delete config.args; delete config.env; delete config.cwd;
  delete config.url; delete config.headers; delete config.type;
  if (row.transport === 'stdio') {
    config.type = 'stdio'; config.command = row.command.trim();
    const args = parseArgsText(row.argsText); if (args) config.args = args;
    if (row.cwd.trim()) config.cwd = row.cwd.trim();
    if (row.envJson.trim()) config.env = parseJsonObject(row.envJson);
    delete config.oauth;
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
  return { clientKey: id, id, transport: typeof raw.url === 'string' ? 'streamable-http' : 'stdio',
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
  const servers = { ...managedServers };
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
