import { TOOL_NAME_SEPARATOR } from './bundle-mcp-names.js';
import { hasAnyMcpServers } from '../../extensions/bundle-mcp.js';
import type { AgentManifest } from '../../agent-manifest/schema.js';
import type { Config } from '../../config/schema.js';

export function shouldCreateBundleMcpRuntimeForAttempt(cfg?: Config): boolean {
  return hasAnyMcpServers(cfg ?? ({} as Config));
}

export function isMcpToolName(toolName: string): boolean {
  return toolName.includes(TOOL_NAME_SEPARATOR);
}

export function parseMcpToolName(toolName: string): { serverId: string; toolId: string } | null {
  const idx = toolName.indexOf(TOOL_NAME_SEPARATOR);
  if (idx <= 0) {
    return null;
  }
  return {
    serverId: toolName.slice(0, idx),
    toolId: toolName.slice(idx + TOOL_NAME_SEPARATOR.length),
  };
}

export function isMcpToolDenied(toolName: string, policy: AgentManifest['tools']['mcp']): boolean {
  const parsed = parseMcpToolName(toolName);
  if (!parsed || !policy) return false;
  return policy.servers?.[parsed.serverId]?.mode === 'deny' || policy.tools?.[toolName]?.mode === 'deny';
}
