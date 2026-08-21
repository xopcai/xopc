import type { AgentManifest } from '../../agent-manifest/schema.js';

export function mcpToolPolicyId(serverId: string, toolName: string): string {
  return `mcp:${encodeURIComponent(serverId)}:${encodeURIComponent(toolName)}`;
}

export function isMcpCatalogToolDenied(
  identity: { serverId: string; policyToolId: string },
  policy: AgentManifest['tools']['mcp'],
): boolean {
  if (!policy) return false;
  return policy.servers?.[identity.serverId]?.mode === 'deny'
    || policy.tools?.[identity.policyToolId]?.mode === 'deny';
}
