import { canonicalizeConfiguredMcpServer } from '../mcp-config-normalize.js';
import type { Config } from '../schema.js';
import { isRecord } from '../../utils/is-record.js';

export interface McpServersPatch {
  servers: Record<string, unknown>;
  sessionIdleTtlMs?: number;
  sessionIdleTtlMinutes?: number;
}

export interface McpServerValidationError {
  path?: string;
  message: string;
}

export function validateMcpServersPatch(
  patch: McpServersPatch,
): McpServerValidationError[] {
  const errors: McpServerValidationError[] = [];
  if (!isRecord(patch.servers)) {
    errors.push({ path: 'servers', message: 'servers must be a JSON object' });
    return errors;
  }

  for (const [id, raw] of Object.entries(patch.servers)) {
    if (!id.trim()) {
      errors.push({ path: 'servers', message: 'MCP server id cannot be empty' });
      continue;
    }
    if (!isRecord(raw)) {
      errors.push({ path: `servers.${id}`, message: 'MCP server config must be a JSON object' });
      continue;
    }
    const hasCommand = typeof raw.command === 'string' && raw.command.trim().length > 0;
    const hasUrl = typeof raw.url === 'string' && raw.url.trim().length > 0;
    if (!hasCommand && !hasUrl) {
      errors.push({
        path: `servers.${id}`,
        message: 'MCP server must define command (stdio) or url (HTTP/SSE)',
      });
    }
  }

  return errors;
}

export function applyMcpServersPatch(cfg: Config, patch: McpServersPatch): Config {
  const mcp = { ...((cfg.mcp ?? {}) as Record<string, unknown>) };
  const servers: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(patch.servers)) {
    const trimmedId = id.trim();
    if (!trimmedId || !isRecord(raw)) continue;
    servers[trimmedId] = canonicalizeConfiguredMcpServer(raw);
  }
  mcp.servers = servers;

  if (patch.sessionIdleTtlMs !== undefined) {
    mcp.sessionIdleTtlMs = patch.sessionIdleTtlMs;
  } else if (patch.sessionIdleTtlMinutes !== undefined) {
    mcp.sessionIdleTtlMs =
      patch.sessionIdleTtlMinutes === 0
        ? 0
        : Math.round(patch.sessionIdleTtlMinutes * 60_000);
  }

  return { ...cfg, mcp } as Config;
}
