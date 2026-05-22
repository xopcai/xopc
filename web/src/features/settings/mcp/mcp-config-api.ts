import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type McpTransportKind = 'stdio' | 'sse' | 'streamable-http';

export type McpServerRow = {
  id: string;
  transport: McpTransportKind;
  command: string;
  argsText: string;
  envJson: string;
  cwd: string;
  url: string;
  headersJson: string;
  connectionTimeoutMs: number | undefined;
};

export type McpSettingsState = {
  sessionIdleTtlMinutes: number | undefined;
  servers: McpServerRow[];
};

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
  if (row.headersJson.trim()) config.headers = parseJsonObject(row.headersJson);
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

  return {
    id,
    transport,
    command: typeof raw.command === 'string' ? raw.command : '',
    argsText: Array.isArray(raw.args) ? raw.args.map(String).join(' ') : '',
    envJson: raw.env && typeof raw.env === 'object' ? JSON.stringify(raw.env, null, 2) : '',
    cwd: typeof raw.cwd === 'string' ? raw.cwd : typeof raw.workingDirectory === 'string' ? raw.workingDirectory : '',
    url: typeof raw.url === 'string' ? raw.url : '',
    headersJson:
      raw.headers && typeof raw.headers === 'object' ? JSON.stringify(raw.headers, null, 2) : '',
    connectionTimeoutMs:
      typeof raw.connectionTimeoutMs === 'number' && Number.isFinite(raw.connectionTimeoutMs)
        ? raw.connectionTimeoutMs
        : undefined,
  };
}

export function emptyMcpServerRow(id = ''): McpServerRow {
  return {
    id,
    transport: 'stdio',
    command: '',
    argsText: '',
    envJson: '',
    cwd: '',
    url: '',
    headersJson: '',
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
          .filter(([, v]) => v && typeof v === 'object')
          .map(([id, v]) => serverConfigToRow(id, v as Record<string, unknown>))
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

export async function patchMcpSettings(state: McpSettingsState): Promise<void> {
  const servers: Record<string, unknown> = {};
  for (const row of state.servers) {
    const id = row.id.trim();
    if (!id) continue;
    servers[id] = rowToServerConfig(row);
  }

  const mcp: Record<string, unknown> = { servers };
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
  tools: string[];
};

export async function testMcpServer(
  serverId: string,
  server?: Record<string, unknown>,
): Promise<McpServerTestResult> {
  const res = await fetchJson<{ ok?: boolean; payload?: McpServerTestResult; error?: string }>(
    apiUrl(`/api/mcp/servers/${encodeURIComponent(serverId)}/test`),
    {
      method: 'POST',
      body: server ? JSON.stringify({ server }) : undefined,
    },
  );
  if (!res.payload) {
    throw new Error(res.error ?? 'MCP test failed');
  }
  return res.payload;
}

export async function fetchMcpServerTools(serverId: string): Promise<Array<{ name: string; description?: string }>> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { tools?: Array<{ name: string; description?: string }> };
    error?: string;
  }>(apiUrl(`/api/mcp/servers/${encodeURIComponent(serverId)}/tools`));
  return res.payload?.tools ?? [];
}
