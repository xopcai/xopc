import type { PluginMcpConnectionTarget } from '@xopcai/gateway-contract';

import { listBundleMcpServerCapabilitiesForGateway } from '../agent/mcp/bundle-mcp-gateway.js';
import { loadMergedBundleMcpConfig } from '../agent/mcp/bundle-mcp-config.js';
import { getMcpOAuthManager, type McpOAuthStatus } from '../agent/mcp/oauth/mcp-oauth-manager.js';
import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import { savePluginAuthBinding } from '../extensions/agent-plugins/auth.js';
import { AgentPluginStore } from '../extensions/agent-plugins/store.js';

export type PluginMcpAvailability = { available: boolean; reason?: string };
export type PluginMcpVerification = { ready: boolean; error?: string };

export interface PluginMcpRecovery {
  availability(target: PluginMcpConnectionTarget): PluginMcpAvailability;
  status(target: PluginMcpConnectionTarget): Promise<McpOAuthStatus>;
  start(target: PluginMcpConnectionTarget): Promise<McpOAuthStatus>;
  verify(target: PluginMcpConnectionTarget): Promise<PluginMcpVerification>;
  submitCallback(target: PluginMcpConnectionTarget, callbackUrl: string): Promise<McpOAuthStatus>;
}

export class HostPluginMcpRecovery implements PluginMcpRecovery {
  constructor(private readonly getConfig: () => Config) {}

  availability(target: PluginMcpConnectionTarget): PluginMcpAvailability {
    const plugin = new AgentPluginStore().get(target.pluginId);
    if (!plugin) return { available: false, reason: 'The plugin is no longer installed.' };
    if (!plugin.receipt.enabled) return { available: false, reason: 'Enable the plugin before connecting its account.' };
    if (plugin.readiness === 'blocked') return { available: false, reason: 'Repair the plugin before connecting its account.' };
    if (plugin.servers[target.serverName]?.type !== 'streamable-http') {
      return { available: false, reason: 'This plugin server does not support OAuth.' };
    }
    return { available: true };
  }

  async status(target: PluginMcpConnectionTarget): Promise<McpOAuthStatus> {
    const server = this.resolveServer(target);
    return getMcpOAuthManager(server).status(target.serverId, server);
  }

  async start(target: PluginMcpConnectionTarget): Promise<McpOAuthStatus> {
    const availability = this.availability(target);
    if (!availability.available) throw new Error(availability.reason);
    await savePluginAuthBinding(new AgentPluginStore(), target.pluginId, target.serverName, { mode: 'oauth' });
    const server = this.resolveServer(target);
    return getMcpOAuthManager(server).start({ serverId: target.serverId, rawServer: server, cfg: this.getConfig() });
  }

  async verify(target: PluginMcpConnectionTarget): Promise<PluginMcpVerification> {
    const availability = this.availability(target);
    if (!availability.available) return { ready: false, error: availability.reason };
    const status = await this.status(target);
    if (status.status !== 'connected') return { ready: false, error: status.session?.error };
    const cfg = this.getConfig();
    const capabilities = await listBundleMcpServerCapabilitiesForGateway({
      workspaceDir: getWorkspacePath(cfg) || './workspace',
      cfg,
      serverId: target.serverId,
    });
    if (capabilities.error) return { ready: false, error: capabilities.error.message };
    if (capabilities.toolCount === 0) return { ready: false, error: 'The connected MCP server did not expose any tools.' };
    return { ready: true };
  }

  async submitCallback(target: PluginMcpConnectionTarget, callbackUrl: string): Promise<McpOAuthStatus> {
    const server = this.resolveServer(target);
    return getMcpOAuthManager(server).submitCallback(target.serverId, server, callbackUrl);
  }

  private resolveServer(target: PluginMcpConnectionTarget): Record<string, unknown> {
    const cfg = this.getConfig();
    const server = loadMergedBundleMcpConfig({ workspaceDir: getWorkspacePath(cfg) || './workspace', cfg })
      .config.mcpServers[target.serverId];
    const origin = server?.xopcPlugin as { id?: string; serverName?: string } | undefined;
    if (!server || origin?.id !== target.pluginId || origin.serverName !== target.serverName) {
      throw new Error('Plugin MCP server is unavailable.');
    }
    return server;
  }
}
