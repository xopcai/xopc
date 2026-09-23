import { AgentPluginStore, type InstalledAgentPlugin } from './store.js';
import { pluginServerId } from './validation.js';

export function agentPluginInventoryRow(plugin: InstalledAgentPlugin) {
  return {
    id: `plugin:${plugin.id}`, pluginId: plugin.id, format: plugin.format,
    name: plugin.manifest.name, version: plugin.manifest.version,
    description: plugin.manifest.description, source: 'agent-plugin',
    active: plugin.receipt.enabled && plugin.readiness !== 'blocked', activationEligible: plugin.receipt.enabled,
    readiness: plugin.readiness, hasUi: false, hasConfigSchema: false,
    canRollback: !!plugin.receipt.previous,
    components: {
      skills: plugin.skills.map(skill => ({ name: skill.name })),
      mcp: Object.entries(plugin.servers).map(([name, server]) => ({ name, id: pluginServerId(plugin.id, name), type: server.type })),
    },
    diagnostics: plugin.diagnostics,
  };
}
export function listAgentPluginInventory() { return new AgentPluginStore().list().map(agentPluginInventoryRow); }
