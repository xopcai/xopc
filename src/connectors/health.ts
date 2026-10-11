import { currentAccountConnections } from './account-access.js';
import { listConnectorConnections } from '../storage/sqlite/connector-repository.js';
import { verifyCliConnection, describeCliAction } from './cli/runtime.js';
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
  if (/401|unauthorized|forbidden|permission denied/i.test(message)) {
    return 'unauthorized';
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

  if (!instance.enabled) {
    return {
      serverId,
      ok: false,
      status: 'disabled',
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      tools: [],
      resources: [],
      prompts: [],
      action: 'Enable the connector before running a health check.',
    };
  }

  if (instance.materialized.type === 'cli') {
    const base = { serverId, toolCount: 0, resourceCount: 0, promptCount: 0, tools: [], resources: [], prompts: [] };
    try {
      const connections = currentAccountConnections(listConnectorConnections({ principalId: 'local-owner', connectorId: instance.connectorId }))
        .filter(connection => connection.provider === 'cli' && connection.status === 'active' && connection.metadata.runtimeInstanceId === serverId);
      if (!connections.length) return { ...base, ok: false, status: 'unauthorized', action: 'Connect an account.' };
      const tools: ConnectorHealthResult['tools'] = [];
      for (const connection of connections) {
        const { adapter } = await verifyCliConnection(config, serverId, connection);
        for (const id of Object.keys(adapter.curatedActions)) {
          const action = await describeCliAction(config, serverId, connection, id);
          if (!tools.some(tool => tool.name === id)) tools.push({ name: id, description: action.description });
        }
      }
      return { ...base, ok: true, status: 'ok', tools, toolCount: tools.length };
    } catch (error) { return { ...base, ok: false, status: classifyConnectorHealthError(error), error: error instanceof Error ? error.message : String(error) }; }
  }

  throw new Error('MCP diagnostics are provided by xopc mcp list.');
}
