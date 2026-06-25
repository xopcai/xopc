import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import {
  listBundleMcpServerCapabilitiesForGateway,
} from '../agent/mcp/bundle-mcp-materialize.js';
import type { Config } from '../config/schema.js';
import { getConnectorInstance } from './instances.js';
import type { ConnectorHealthResult, ConnectorHealthStatus } from './types.js';

function classifyConnectorHealthError(error: unknown): ConnectorHealthStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) {
    return 'timeout';
  }
  if (/ECONN|ENOTFOUND|network|fetch failed/i.test(message)) {
    return 'network_failed';
  }
  if (/missing|required|credential|api key|token/i.test(message)) {
    return 'missing_secret';
  }
  if (/tools|listTools/i.test(message)) {
    return 'tools_list_failed';
  }
  if (/spawn|command|start|connect/i.test(message)) {
    return 'startup_failed';
  }
  return 'unknown_error';
}

function healthActionForStatus(status: ConnectorHealthStatus): string | undefined {
  if (status === 'missing_secret') {
    return 'Reconnect the connector and provide the required secret.';
  }
  if (status === 'timeout' || status === 'network_failed') {
    return 'Check network access and retry the connector health check.';
  }
  if (status === 'startup_failed') {
    return 'Verify the connector runtime dependency is installed and reachable.';
  }
  return undefined;
}

export async function testConnectorInstance(config: Config, serverId: string): Promise<ConnectorHealthResult> {
  const instance = getConnectorInstance(config, serverId);
  if (!instance) {
    return {
      serverId,
      ok: false,
      status: 'server_not_found',
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      tools: [],
      resources: [],
      prompts: [],
      error: `Connector instance not found: ${serverId}`,
    };
  }

  const workspaceDir = getWorkspacePath(config) || './workspace';
  try {
    const capabilities = await listBundleMcpServerCapabilitiesForGateway({
      workspaceDir,
      cfg: config,
      serverId,
    });
    return {
      serverId,
      ok: true,
      status: 'ok',
      toolCount: capabilities.toolCount,
      resourceCount: capabilities.resourceCount,
      promptCount: capabilities.promptCount,
      tools: capabilities.tools,
      resources: capabilities.resources,
      prompts: capabilities.prompts,
    };
  } catch (error) {
    const status = classifyConnectorHealthError(error);
    return {
      serverId,
      ok: false,
      status,
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      tools: [],
      resources: [],
      prompts: [],
      error: error instanceof Error ? error.message : String(error),
      action: healthActionForStatus(status),
    };
  }
}
