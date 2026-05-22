import type { AgentTool } from '@earendil-works/pi-agent-core';

const MCP_TOOL_META = Symbol.for('xopc.mcpToolMeta');

export type McpToolMeta = {
  pluginId: string;
  optional?: boolean;
};

export function setPluginToolMeta(tool: AgentTool, meta: McpToolMeta): void {
  (tool as unknown as Record<symbol, McpToolMeta>)[MCP_TOOL_META] = meta;
}

export function getPluginToolMeta(tool: AgentTool): McpToolMeta | undefined {
  return (tool as unknown as Record<symbol, McpToolMeta>)[MCP_TOOL_META];
}

export function isBundleMcpTool(tool: AgentTool): boolean {
  return getPluginToolMeta(tool)?.pluginId === 'bundle-mcp';
}
