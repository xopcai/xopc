import type { AgentManifest, ToolPolicy } from '../../agent-manifest/schema.js';
import { sanitizeServerName } from './bundle-mcp-names.js';

export function mcpToolPolicyId(serverId: string, toolName: string): string {
  return `mcp:${encodeURIComponent(serverId)}:${encodeURIComponent(toolName)}`;
}

export function resolveMcpToolPolicy(
  identity: { serverId: string; policyToolId: string },
  policy: AgentManifest['tools']['mcp'],
): ToolPolicy | undefined {
  const toolPolicy = policy?.tools?.[identity.policyToolId];
  if (toolPolicy) return toolPolicy;
  const directServerPolicy = policy?.servers?.[identity.serverId];
  if (directServerPolicy) return directServerPolicy;

  const usedNames = new Set<string>();
  for (const [serverId, serverPolicy] of Object.entries(policy?.servers ?? {})) {
    if (sanitizeServerName(serverId, usedNames) === identity.serverId) return serverPolicy;
  }
  return undefined;
}

export function isMcpCatalogToolDenied(
  identity: { serverId: string; policyToolId: string },
  policy: AgentManifest['tools']['mcp'],
): boolean {
  return resolveMcpToolPolicy(identity, policy)?.mode === 'deny';
}
