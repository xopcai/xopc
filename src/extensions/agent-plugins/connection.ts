import type { ConnectionNeed } from '@xopcai/gateway-contract';

import { AgentPluginStore } from './store.js';
import { pluginServerId } from './validation.js';

const PREFIX = 'plugin-mcp:';

export function pluginMcpCandidateRef(pluginId: string, serverName: string): string {
  return `${PREFIX}${encodeURIComponent(pluginId)}:${encodeURIComponent(serverName)}`;
}

export function parsePluginMcpCandidateRef(ref: string): { pluginId: string; serverName: string } | undefined {
  if (!ref.startsWith(PREFIX)) return undefined;
  const parts = ref.slice(PREFIX.length).split(':');
  if (parts.length !== 2) return undefined;
  try {
    return { pluginId: decodeURIComponent(parts[0]!), serverName: decodeURIComponent(parts[1]!) };
  } catch {
    return undefined;
  }
}

export function resolvePluginMcpConnectionCandidate(
  ref: string,
  store = new AgentPluginStore(),
): ConnectionNeed | undefined {
  const parsed = parsePluginMcpCandidateRef(ref);
  if (!parsed) return undefined;
  const plugin = store.get(parsed.pluginId);
  const server = plugin?.servers[parsed.serverName];
  if (!plugin || !server || !plugin.receipt.enabled || plugin.readiness === 'blocked' || server.type !== 'streamable-http') {
    return undefined;
  }
  const serverId = pluginServerId(plugin.id, parsed.serverName);
  return {
    key: serverId,
    target: { type: 'plugin-mcp', pluginId: plugin.id, serverId, serverName: parsed.serverName },
    label: plugin.manifest.name,
    capabilities: [`mcp.tools:${serverId}`],
  };
}
