import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import {
  headersToRecord,
  recordToHeaders,
  type McpHeaderEntry,
} from '@/features/settings/connectors/mcp/mcp-headers-utils';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type McpToolInfo = {
  name: string;
  shortName?: string;
  description?: string;
};

export type McpTransportKind = 'stdio' | 'sse' | 'streamable-http';

export type McpServerRow = {
  /** Stable React list key; not persisted to config. */
  clientKey: string;
  id: string;
  transport: McpTransportKind;
  command: string;
  argsText: string;
  envJson: string;
  cwd: string;
  url: string;
  headers: McpHeaderEntry[];
  connectionTimeoutMs: number | undefined;
};

export type McpSettingsState = {
  sessionIdleTtlMinutes: number | undefined;
  servers: McpServerRow[];
};

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
  if (row.transport === 'stdio') {
    const config: Record<string, unknown> = {
      command: row.command.trim(),
    };
    const args = parseArgsText(row.argsText);
    if (args?.length) config.args = args;
    if (row.cwd.trim()) config.cwd = row.cwd.trim();
    if (row.envJson.trim()) config.env = parseJsonObject(row.envJson);
    if (row.connectionTimeoutMs != null && Number.isFinite(row.connectionTimeoutMs)) {
      config.connectionTimeoutMs = row.connectionTimeoutMs;
    }
    return config;
  }

  const config: Record<string, unknown> = {
    url: row.url.trim(),
    transport: row.transport,
  };
  const headers = headersToRecord(row.headers);
  if (headers) config.headers = headers;
  if (row.connectionTimeoutMs != null && Number.isFinite(row.connectionTimeoutMs)) {
    config.connectionTimeoutMs = row.connectionTimeoutMs;
  }
  return config;
}

function serverConfigToRow(id: string, raw: Record<string, unknown>): McpServerRow {
  const hasUrl = typeof raw.url === 'string' && raw.url.trim().length > 0;
  const transportRaw = typeof raw.transport === 'string' ? raw.transport.trim().toLowerCase() : '';
  const transport: McpTransportKind = hasUrl
    ? transportRaw === 'sse'
      ? 'sse'
      : 'streamable-http'
    : 'stdio';

  const headersRaw =
    raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)
      ? (raw.headers as Record<string, unknown>)
      : undefined;

  return {
    clientKey: id,
    id,
    transport,
    command: typeof raw.command === 'string' ? raw.command : '',
    argsText: Array.isArray(raw.args) ? raw.args.map(String).join(' ') : '',
    envJson: raw.env && typeof raw.env === 'object' ? JSON.stringify(raw.env, null, 2) : '',
    cwd: typeof raw.cwd === 'string' ? raw.cwd : typeof raw.workingDirectory === 'string' ? raw.workingDirectory : '',
    url: typeof raw.url === 'string' ? raw.url : '',
    headers: recordToHeaders(headersRaw),
    connectionTimeoutMs:
      typeof raw.connectionTimeoutMs === 'number' && Number.isFinite(raw.connectionTimeoutMs)
        ? raw.connectionTimeoutMs
        : undefined,
  };
}

export function emptyMcpServerRow(id = ''): McpServerRow {
  return {
    clientKey: crypto.randomUUID(),
    id,
    transport: 'stdio',
    command: '',
    argsText: '',
    envJson: '',
    cwd: '',
    url: '',
    headers: [{ key: 'Authorization', value: '' }],
    connectionTimeoutMs: undefined,
  };
}

export function normalizeMcpSettingsFromConfig(cfg: unknown): McpSettingsState {
  const mcp =
    cfg && typeof cfg === 'object' && 'mcp' in cfg ? (cfg as { mcp?: unknown }).mcp : undefined;
  const root = mcp && typeof mcp === 'object' ? (mcp as Record<string, unknown>) : {};
  const serversRaw = root.servers;
  const servers: McpServerRow[] =
    serversRaw && typeof serversRaw === 'object' && !Array.isArray(serversRaw)
      ? Object.entries(serversRaw as Record<string, unknown>)
          .flatMap(([id, v]) => {
            if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
            if (isManagedConnectorServerConfig(v)) return [];
            return [serverConfigToRow(id, v as Record<string, unknown>)];
          })
          .sort((a, b) => a.id.localeCompare(b.id))
      : [];

  const ttlMs = typeof root.sessionIdleTtlMs === 'number' ? root.sessionIdleTtlMs : undefined;
  const sessionIdleTtlMinutes =
    ttlMs == null ? undefined : ttlMs === 0 ? 0 : Math.round(ttlMs / 60_000);

  return { sessionIdleTtlMinutes, servers };
}

export function buildMcpServerConfigFromRow(row: McpServerRow): Record<string, unknown> {
  return rowToServerConfig(row);
}

export async function patchMcpSettings(
  state: McpSettingsState,
  managedServers: Record<string, Record<string, unknown>> = {},
): Promise<void> {
  const customServers: Record<string, unknown> = {};
  for (const row of state.servers) {
    const id = row.id.trim();
    if (!id) continue;
    if (managedServers[id]) {
      throw new Error(`Server id "${id}" is reserved by an installed connector.`);
    }
    customServers[id] = rowToServerConfig(row);
  }

  const mcp: Record<string, unknown> = {
    servers: { ...managedServers, ...customServers },
  };
  if (state.sessionIdleTtlMinutes != null && Number.isFinite(state.sessionIdleTtlMinutes)) {
    mcp.sessionIdleTtlMs =
      state.sessionIdleTtlMinutes === 0 ? 0 : Math.round(state.sessionIdleTtlMinutes * 60_000);
  }

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ mcp }),
  });
  void revalidateGatewayConfig();
}

export type McpServerTestResult = {
  serverId: string;
  toolCount: number;
  tools: McpToolInfo[];
};

/** Accept legacy `string[]` or `{ name, description? }[]` from the gateway. */
function normalizeMcpTools(tools: unknown): McpToolInfo[] {
  if (!Array.isArray(tools)) return [];
  const out: McpToolInfo[] = [];
  for (const item of tools) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (name) out.push({ name });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const raw = item as { name?: unknown; shortName?: unknown; description?: unknown };
    if (typeof raw.name !== 'string') continue;
    const name = raw.name.trim();
    if (!name) continue;
    const shortName =
      typeof raw.shortName === 'string' && raw.shortName.trim() ? raw.shortName.trim() : undefined;
    const description =
      typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim()
        : undefined;
    out.push({ name, shortName, description });
  }
  return out;
}

export async function testMcpServer(
  serverId: string,
  server?: Record<string, unknown>,
): Promise<McpServerTestResult> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { serverId?: string; toolCount?: number; tools?: unknown };
    error?: string;
  }>(
    apiUrl(`/api/mcp/servers/${encodeURIComponent(serverId)}/test`),
    {
      method: 'POST',
      body: server ? JSON.stringify({ server }) : undefined,
    },
  );
  if (!res.payload) {
    throw new Error(res.error ?? 'MCP test failed');
  }
  const tools = normalizeMcpTools(res.payload.tools);
  return {
    serverId: res.payload.serverId ?? serverId,
    toolCount: typeof res.payload.toolCount === 'number' ? res.payload.toolCount : tools.length,
    tools,
  };
}

export function connectionTimeoutSeconds(row: McpServerRow): string {
  if (row.connectionTimeoutMs == null || !Number.isFinite(row.connectionTimeoutMs)) return '';
  return String(Math.round(row.connectionTimeoutMs / 1000));
}

export function parseConnectionTimeoutSeconds(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) return undefined;
  return seconds * 1000;
}

export function mcpServerCardKey(row: McpServerRow, _index: number): string {
  return row.clientKey;
}
