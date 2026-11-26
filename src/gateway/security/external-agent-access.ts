import { getExternalAgentDriver, type ExternalStoredAgent } from '../../agent/external/index.js';
import type { GatewayPrincipal } from './gateway-principal.js';
import { hasGatewayScope } from './gateway-scopes.js';

export function externalAgentAccessError(agent: ExternalStoredAgent | undefined, principal: GatewayPrincipal): string | undefined {
  if (!agent) return undefined;
  const driver = getExternalAgentDriver(agent.execution.kind);
  if (driver.capabilities.requiresWorkspaceWrite && !hasGatewayScope(principal.scopes, 'workspace.write')) {
    return `${driver.label} requires workspace write access`;
  }
  return undefined;
}
