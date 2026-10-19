import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginAuthorizations } from './setup-contract.js';
import { AgentPluginStore, type InstalledAgentPlugin } from './store.js';
import { pluginServerId } from './validation.js';
import { pluginBranding, pluginLocalizations } from './branding.js';

export function agentPluginInventoryRow(plugin: InstalledAgentPlugin, store = new AgentPluginStore()) {
  const setupPath = join(store.stateDir, 'plugin-setup', `${plugin.id}.json`);
  let saved;
  try { saved = existsSync(setupPath) ? JSON.parse(readFileSync(setupPath, 'utf8')) : undefined; } catch { /* Store readiness already reports damaged setup state. */ }
  const job = saved?.packageRevision === plugin.receipt.revision ? saved : undefined;
  let authorizations: ReturnType<typeof pluginAuthorizations> = [];
  try { authorizations = pluginAuthorizations(plugin.manifest); } catch { /* The package carries an invalid authorization diagnostic. */ }
  const needsAuthorization = !!job && ((job.missingConfig?.length ?? 0) > 0 || job.connections?.some((value: { state: string }) => value.state !== 'connected') || job.authorizations?.some((value: { state: string }) => value.state !== 'connected'));
  return {
    id: `plugin:${plugin.id}`, pluginId: plugin.id, format: plugin.format,
    name: plugin.manifest.name, version: plugin.manifest.version ?? plugin.receipt.provenance?.version,
    description: plugin.manifest.description, source: 'agent-plugin',
    localizations: pluginLocalizations(plugin.manifest),
    branding: pluginBranding(plugin.rootDir, plugin.manifest),
    active: plugin.receipt.enabled && plugin.readiness !== 'blocked' && plugin.readiness !== 'setup_required', activationEligible: plugin.receipt.enabled,
    installationState: job?.installed || job?.state === 'completed' ? 'installed' : job ? 'preparing' : 'installed',
    authorizationStatus: needsAuthorization ? 'required' : job?.connections?.length || authorizations.length ? 'connected' : 'not_required',
    readiness: plugin.readiness, hasUi: false, hasConfigSchema: false,
    canRollback: !!plugin.receipt.previous,
    ...(plugin.receipt.provenance ? { provenance: plugin.receipt.provenance } : {}),
    components: {
      skills: plugin.skills.map(skill => ({ name: skill.name })),
      mcp: Object.entries(plugin.servers).map(([name, server]) => ({ name, id: pluginServerId(plugin.id, name), type: server.type, ...(server.type !== 'stdio' ? { connectionAuth: server.connectionAuth } : {}) })),
    },
    installationSource: plugin.receipt.source,
    resolvedCommit: plugin.receipt.resolvedCommit,
    dialect: plugin.layout?.dialect ?? 'portable',
    verification: 'unverified',
    compatibility: plugin.layout?.compatibility ?? [],
    workspacePaths: plugin.receipt.workspacePaths ?? null,
    setup: { authorizations, userConfig: Object.fromEntries(Object.entries(plugin.layout?.userConfig ?? {}).map(([key, field]) => [key, { ...field, default: field.sensitive ? undefined : field.default }])), tasks: plugin.layout?.tasks ?? [] },
    diagnostics: plugin.diagnostics,
  };
}
export function listAgentPluginInventory() { const store = new AgentPluginStore(); return store.list().map(plugin => agentPluginInventoryRow(plugin, store)); }
