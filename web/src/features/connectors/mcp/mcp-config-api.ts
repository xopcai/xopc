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
  return trimmed.split(/\s+/).filter(Boolean);
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
    command: typeof raw.command === 'string' ? raw.command : '', argsText: Array.isArray(raw.args) ? raw.args.join(' ') : '',
    envJson: raw.env ? JSON.stringify(raw.env, null, 2) : '', cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    url: typeof raw.url === 'string' ? raw.url : '', headers: recordToHeaders(raw.headers as Record<string, unknown> | undefined),
    oauthClientId: typeof oauth?.clientId === 'string' ? oauth.clientId : '',
    timeout: typeof raw.timeout === 'number' ? raw.timeout : undefined,
    exposure: (raw.exposure as McpServerRow['exposure']) ?? 'codemode', extra: raw,
  };
}
export function emptyMcpServerRow(id = ''): McpServerRow {
  return { clientKey: crypto.randomUUID(), id, transport: 'stdio', command: '', argsText: '', envJson: '', cwd: '',
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
