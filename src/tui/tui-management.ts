import { z } from 'zod';

import { fetchRegistry } from '../extensions/marketplace.js';
import { SessionEnvironmentService } from '../execution-environments/session-environment-service.js';
import { LocalWorktreeManager } from '../execution-environments/local-worktree-manager.js';
import { ExecutionEnvironmentStore } from '../execution-environments/store.js';
import { getProjectForSession } from '../projects/workspace.js';
import { isEmbeddedRunActive } from '../agent/embedded/runs.js';
import { commandRegistry } from '../agent/commands/command-registry.js';
import { listChildRuns } from '../agent/orchestration/child-run-monitor.js';
import { getSessionInteractionPolicy } from '../agent/session/interaction-policy.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import type { Config } from '../config/schema.js';
import { resolveMcpSetupConfig } from '../agent/mcp/effective-server.js';
import { probeMcpConnection, startMcpAuthorization, getMcpAuthorization, submitMcpRedirect, cancelMcpAuthorization } from '../agent/mcp/connection-setup.js';
import { discoverMcpTools } from '../agent/mcp/tool-catalog.js';
import { prepareNativeMcpConfig } from '../agent/mcp/native-mcp.js';
import { createNativeMcpCredentials } from '../agent/mcp/credential-store.js';
import { AgentPluginStore } from '../extensions/agent-plugins/store.js';
import { withAgentPluginSource } from '../extensions/agent-plugins/sources.js';
import { agentPluginInventoryRow } from '../extensions/agent-plugins/inventory.js';
import { PluginSetupService, setupActionSchema } from '../extensions/agent-plugins/setup.js';
import { removePluginCredentials } from '../extensions/agent-plugins/credentials.js';
import { evictAllEmbeddedSessionRunners } from '../agent/embedded/session-runner.js';

export const tuiManagementSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('worktree.list') }),
  z.strictObject({ action: z.literal('worktree.create'), baseRef: z.string().min(1).max(1000).default('HEAD') }),
  z.strictObject({ action: z.literal('worktree.use'), id: z.string().uuid() }),
  z.strictObject({ action: z.literal('worktree.remove'), id: z.string().uuid() }),
  z.strictObject({ action: z.literal('mcp.probe'), id: z.string().min(1) }),
  z.strictObject({ action: z.literal('mcp.tools'), id: z.string().min(1) }),
  z.strictObject({ action: z.literal('mcp.login'), id: z.string().min(1) }),
  z.strictObject({ action: z.literal('mcp.logout'), id: z.string().min(1) }),
  z.strictObject({ action: z.literal('mcp.auth'), id: z.string().uuid() }),
  z.strictObject({ action: z.literal('mcp.cancel'), id: z.string().uuid() }),
  z.strictObject({ action: z.literal('mcp.redirect'), id: z.string().uuid(), url: z.string().max(16384) }),
  z.strictObject({ action: z.literal('plugin.catalog'), query: z.string().max(200).optional() }),
  z.strictObject({ action: z.literal('plugin.inspect'), source: z.string().min(1).max(4096) }),
  z.strictObject({ action: z.literal('plugin.install'), source: z.string().min(1).max(4096), reviewHash: z.string().min(1), replaceId: z.string().optional() }),
  z.strictObject({ action: z.literal('plugin.get'), id: z.string().min(1) }),
  z.strictObject({ action: z.literal('plugin.enable'), id: z.string().min(1), enabled: z.boolean() }),
  z.strictObject({ action: z.literal('plugin.remove'), id: z.string().min(1), credentials: z.boolean().default(false) }),
  z.strictObject({ action: z.literal('plugin.rollback'), id: z.string().min(1) }),
  z.strictObject({ action: z.literal('plugin.setup'), id: z.string().min(1), command: setupActionSchema.optional() }),
  z.strictObject({ action: z.literal('plugin.setup.get'), id: z.string().min(1) }),
]);
export type TuiManagementCommand = z.infer<typeof tuiManagementSchema>;

/** Shared user-initiated management actions. Agent tools cannot invoke this control plane. */
export async function manageTuiCapability(input: { config: Config; workspace: string; owner: string; conversationId?: string; command: TuiManagementCommand }): Promise<unknown> {
  const command = tuiManagementSchema.parse(input.command);
  const { config, workspace, owner } = input;
  if (command.action.startsWith('worktree.')) {
    const conversationId = input.conversationId;
    const project = conversationId ? getProjectForSession(conversationId) : null;
    if (!conversationId || !project) throw new Error('A persisted project conversation is required for worktree management.');
    const store = new ExecutionEnvironmentStore(), manager = new LocalWorktreeManager({ store });
    if (command.action === 'worktree.list') return store.list({ projectId: project.id, limit: 200 });
    const assertIdle = () => {
      if (isEmbeddedRunActive(conversationId) || commandRegistry().list(conversationId).some(job => job.status === 'running') || listChildRuns(conversationId).some(child => child.status === 'running')) throw new Error('Stop running work before changing execution environments.');
      const policy = getSessionInteractionPolicy(conversationId);
      if (policy.mode === 'plan' || policy.access === 'read-only') throw new Error('Switch out of Plan and read-only modes before changing worktrees.');
    };
    assertIdle();
    if (command.action === 'worktree.remove') {
      const environment = store.getRequired(command.id);
      if (environment.projectId !== project.id || environment.kind !== 'managed_worktree') throw new Error('Managed worktree not found in this project.');
      return manager.remove(command.id, { releaseConversationId: conversationId });
    }
    const environment = command.action === 'worktree.create'
      ? await manager.provisionManagedWorktree({ projectId: project.id, repositoryPath: project.workspaceRoot ?? workspace, baseRef: command.baseRef })
      : command.action === 'worktree.use' ? store.getRequired(command.id) : undefined;
    if (!environment || environment.projectId !== project.id || environment.status !== 'ready') throw new Error('Ready worktree not found in this project.');
    assertIdle();
    runSqliteWriteTransaction(() => {
      const current = new SessionEnvironmentService({ store }).get(conversationId);
      if (current) store.releaseBinding(conversationId, current.id);
      store.bind({ conversationId, environmentId: environment.id });
    });
    evictAllEmbeddedSessionRunners(); return environment;
  }
  if (command.action.startsWith('mcp.')) {
    if (command.action === 'mcp.auth') return getMcpAuthorization(command.id, owner, config) ?? null;
    if (command.action === 'mcp.cancel') { if (!cancelMcpAuthorization(command.id, owner)) throw new Error('Sign-in not found'); return null; }
    if (command.action === 'mcp.redirect') { if (!submitMcpRedirect(command.id, owner, command.url, config)) throw new Error('Callback does not match this sign-in.'); return null; }
    if (command.action === 'mcp.probe') return probeMcpConnection(resolveMcpSetupConfig(config, command.id), workspace, command.id);
    if (command.action === 'mcp.tools') return discoverMcpTools(resolveMcpSetupConfig(config, command.id), workspace, command.id);
    if (command.action === 'mcp.login') return startMcpAuthorization(config, workspace, command.id, owner);
    if (command.action === 'mcp.logout') {
      const prepared = await prepareNativeMcpConfig(resolveMcpSetupConfig(config, command.id), workspace);
      const server = prepared.servers.find(server => server.name === command.id);
      if (!server) throw new Error('MCP server not found');
      const credentials = prepared.credentials ?? await createNativeMcpCredentials();
      credentials.remove(prepared.credentialAliases?.[command.id] ?? command.id, 'url' in server.config ? server.config.url : undefined);
      evictAllEmbeddedSessionRunners(); return null;
    }
  }
  const store = new AgentPluginStore();
  const setup = new PluginSetupService(store);
  const refresh = () => { evictAllEmbeddedSessionRunners(); };
  switch (command.action) {
    case 'plugin.catalog': { const registry = await fetchRegistry(true); return registry.extensions.filter(entry => entry.packageType === 'plugin' && (!command.query || `${entry.name} ${entry.description ?? ''}`.toLowerCase().includes(command.query.toLowerCase()))); }
    case 'plugin.inspect': return withAgentPluginSource(command.source, config, (source, _provenance, resolvedCommit, manifest) => ({ ...store.inspect(source, command.source, manifest), resolvedCommit }));
    case 'plugin.install': {
      const plugin = await withAgentPluginSource(command.source, config, (source, provenance, resolvedCommit, manifest) => store.install(source, {
        reviewHash: command.reviewHash, sourceLabel: command.source, provenance, resolvedCommit, importManifest: manifest,
        replace: Boolean(command.replaceId), stage: Boolean(command.replaceId), expectedId: command.replaceId }));
      if (plugin.readiness !== 'blocked') setup.create(plugin.id, owner);
      refresh(); return agentPluginInventoryRow(plugin);
    }
    case 'plugin.get': {
      const plugin = store.pending(command.id) ?? store.get(command.id);
      if (!plugin) throw new Error('Plugin not found'); return agentPluginInventoryRow(plugin);
    }
    case 'plugin.enable': {
      const job = setup.get(command.id, owner);
      if (command.enabled && job && job.state !== 'completed') throw new Error('Finish plugin setup before enabling.');
      const plugin = store.setEnabled(command.id, command.enabled); refresh(); return agentPluginInventoryRow(plugin); }
    case 'plugin.remove': { if (command.credentials) await removePluginCredentials(store, command.id); store.remove(command.id, false); refresh(); return null; }
    case 'plugin.rollback': { const plugin = store.rollback(command.id); refresh(); return agentPluginInventoryRow(plugin); }
    case 'plugin.setup.get': return setup.get(command.id, owner) ?? null;
    case 'plugin.setup': {
      if (!command.command) return setup.create(command.id, owner);
      const result = command.command.action === 'prepare'
        ? setup.startPrepare(command.id, owner, command.command.expectedRevision, config, workspace, command.command.idempotencyKey)
        : await setup.act(command.id, owner, command.command, config, workspace);
      refresh(); return result;
    }
    default: throw new Error('Unsupported capability action');
  }
}
