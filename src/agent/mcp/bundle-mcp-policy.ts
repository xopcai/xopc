import { TOOL_NAME_SEPARATOR } from './bundle-mcp-names.js';
import { hasAnyMcpServers } from '../../extensions/bundle-mcp.js';
import type { Config } from '../../config/schema.js';

export function shouldCreateBundleMcpRuntimeForAttempt(params: {
  cfg?: Config;
  toolsEnabled?: boolean;
  disabledTools?: Set<string>;
}): boolean {
  if (params.toolsEnabled === false) {
    return false;
  }
  if (params.disabledTools?.has('bundle-mcp')) {
    return false;
  }
  return hasAnyMcpServers(params.cfg ?? ({} as Config));
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
