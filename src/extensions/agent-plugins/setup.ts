import { pluginAuthorizations, pluginPermissionIssueSchema } from './setup-contract.js';
import { cancelPluginCliAuthorizations, inspectPluginCliAuthorization, getPluginCliAuthorization, startPluginCliAuthorization } from './cli-authorization.js';
import { readPluginUserConfig } from './user-config.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';

import { createLogger } from '../../utils/logger.js';
import type { Config } from '../../config/schema.js';
import { writeTextAtomicSync } from '../../infra/write-file-atomic.js';
import { probeMcpConnection, startMcpAuthorization, getMcpAuthorization, cancelMcpAuthorization, submitMcpRedirect } from '../../agent/mcp/connection-setup.js';
import { connectionFingerprint, matchingReusableConnection } from './connection-reuse.js';
import { savePluginOAuthReference, readPluginAuthBinding, savePluginAuthBinding } from './auth.js';
import { createNativeMcpCredentials } from '../../agent/mcp/credential-store.js';
import { getNativePiAgentDir } from '../../agent/mcp/native-mcp.js';
import { AgentPluginStore } from './store.js';
import { pluginName, pluginServerId } from './validation.js';
import { materializePluginServers } from './mcp-adapter.js';
import { pluginConfigMissing, savePluginUserConfig } from './user-config.js';
import { preparePluginResources } from './resources.js';

const connection = z.object({ name: z.string(), state: z.enum(['pending', 'connected', 'oauth_required', 'token_required', 'error', 'skipped']), toolCount: z.number().optional(), authorizationId: z.string().optional() });
const schema = z.object({
  id: z.string().uuid(), pluginId: pluginName, owner: z.string(), packageRevision: z.string().uuid(), revision: z.number().int(),
  state: z.enum(['pending', 'running', 'action_required', 'completed', 'cancelled', 'interrupted', 'failed']),
  resources: z.enum(['pending', 'running', 'ready', 'error']), connections: z.array(connection),
  installed: z.boolean().default(false), deferred: z.boolean().default(false),
  authorizations: z.array(z.object({ id: z.string(), expiresAt: z.number().finite().optional(), state: z.enum(['pending', 'connected', 'skipped', 'error']), issues: z.array(pluginPermissionIssueSchema).max(20).default([]), method: z.string().optional(), attemptId: z.string().optional() })).default([]),
  operations: z.array(z.object({ key: z.string().uuid(), action: z.string() })).max(100).default([]),
  missingConfig: z.array(z.string()).default([]), partial: z.boolean(), updatedAt: z.string(), error: z.string().optional(),
});
export type PluginSetupJob = z.infer<typeof schema>;
const actionRevision = { expectedRevision: z.number().int(), idempotencyKey: z.string().uuid().optional() };
export const setupActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('prepare'), ...actionRevision }),
  z.strictObject({ action: z.literal('reuse'), ...actionRevision, server: z.string(), sourceServerId: z.string() }),
  z.strictObject({ action: z.literal('authorize'), ...actionRevision, server: z.string(), method: z.string().optional() }),
  z.strictObject({ action: z.literal('configure'), ...actionRevision, values: z.record(z.string(), z.unknown()), authorization: z.string().optional(), method: z.string().optional() }),
  z.strictObject({ action: z.literal('complete'), ...actionRevision, workspacePaths: z.array(z.string().min(1)).max(100).nullable().optional(), allowPartial: z.boolean().default(false) }),
  z.strictObject({ action: z.literal('defer'), ...actionRevision }),
  z.strictObject({ action: z.literal('cancel'), ...actionRevision }),
]);
const log = createLogger('PluginSetup');
const running = new Map<string, AbortController>();
export class PluginSetupService {
  constructor(readonly store = new AgentPluginStore()) {}
  private path(id: string) { return join(this.store.stateDir, 'plugin-setup', `${pluginName.parse(id)}.json`); }
  private key(id: string) { return this.path(id); }
  private write(job: PluginSetupJob) {
    job.revision++; job.updatedAt = new Date().toISOString();
    writeTextAtomicSync(this.path(job.pluginId), JSON.stringify(schema.parse(job)));
  }
  get(id: string, owner: string): PluginSetupJob | undefined {
    if (!existsSync(this.path(id))) return;
    const job = schema.parse(JSON.parse(readFileSync(this.path(id), 'utf8')));
    if (job.owner !== owner) throw new Error('Setup belongs to another principal');
    if (job.state === 'running' && !running.has(this.key(id)) && !lockfile.checkSync(this.path(id), { realpath: false })) { job.state = 'interrupted'; job.error = 'Preparation was interrupted. Retry to continue.'; this.write(job); }
    return job;
  }
  create(id: string, owner: string): PluginSetupJob {
    const plugin = this.store.pending(id) ?? this.store.get(id);
    if (!plugin || plugin.readiness === 'blocked') throw new Error('Plugin unavailable');
    const previous = this.get(id, owner);
    if (previous?.packageRevision === plugin.receipt.revision && previous.state !== 'cancelled') return previous;
    if (running.has(this.key(id)) || lockfile.checkSync(this.path(id), { realpath: false })) throw new Error('Preparation is already running');
    const job: PluginSetupJob = { id: randomUUID(), pluginId: id, owner, packageRevision: plugin.receipt.revision, revision: 0,
      state: 'pending', resources: 'pending', connections: Object.keys(plugin.servers).map(name => ({ name, state: 'pending' })),
      installed: false, deferred: false, authorizations: pluginAuthorizations(plugin.manifest).map(value => ({ id: value.id, state: 'pending' as const, issues: [] })),
      operations: [], missingConfig: pluginConfigMissing(this.store, plugin), partial: plugin.diagnostics.length > 0, updatedAt: new Date().toISOString() };
    this.write(job); return job;
  }
  invalidateConnection(id: string, owner: string, name: string): void {
    const job = this.get(id, owner); if (!job) return;
    running.get(this.key(id))?.abort();
    const server = job.connections.find(value => value.name === name);
    if (server) { if (server.authorizationId) cancelMcpAuthorization(server.authorizationId, owner); server.state = 'pending'; delete server.authorizationId; }
    job.state = 'action_required'; this.write(job);
  }
  async reusableConnections(id: string, owner: string, config: Config): Promise<Record<string, Array<{ id: string; name: string }>>> {
    const job = this.get(id, owner); if (!job) return {};
    const plugin = this.store.pending(id) ?? this.store.get(id); if (!plugin) return {};
    getNativePiAgentDir();
    const credentials = await createNativeMcpCredentials();
    const result: Record<string, Array<{ id: string; name: string }>> = {};
    for (const [name, target] of Object.entries(plugin.servers)) {
      result[name] = [];
      for (const [sourceId, source] of Object.entries(config.mcp?.servers ?? {})) {
        if (!matchingReusableConnection(target, source) || !source.url || !source.xopcOAuthCredentialId) continue;
        if (await credentials.tokens(source.xopcOAuthCredentialId, source.url)) result[name].push({ id: sourceId, name: source.displayName ?? sourceId });
      }
    }
    return result;
  }
  async authorization(id: string, owner: string, server: string, config: Config) {
    const job = this.get(id, owner); if (!job) throw new Error('Setup not found');
    const declared = pluginAuthorizations((this.store.pending(id) ?? this.store.get(id))!.manifest).find(value => value.id === server);
    const selected = job.authorizations.find(value => value.id === server);
    const method = declared?.methods.find(value => value.id === selected?.method);
    if (method?.type === 'cli') return selected?.attemptId ? getPluginCliAuthorization(selected.attemptId, owner, job.packageRevision) : undefined;
    const target = job.connections.find(c => c.name === (method?.type === 'oauth' ? method.server : server));
    if (!target?.authorizationId) return undefined;
    const effective = this.config(id, job.packageRevision, config);
    return getMcpAuthorization(target.authorizationId, owner, effective);
  }
  redirect(id: string, owner: string, server: string, url: string, config: Config): boolean {
    const job = this.get(id, owner);
    const declaration = pluginAuthorizations((this.store.pending(id) ?? this.store.get(id))!.manifest).find(value => value.id === server);
    const selected = job?.authorizations.find(value => value.id === server);
    const method = declaration?.methods.find(value => value.id === selected?.method);
    const attempt = job?.connections.find(c => c.name === (method?.type === 'oauth' ? method.server : server))?.authorizationId;
    return !!job && !!attempt && submitMcpRedirect(attempt, owner, url, this.config(id, job.packageRevision, config));
  }
  private config(id: string, revision: string, config: Config): Config {
    const plugin = this.store.pending(id) ?? this.store.get(id);
    if (!plugin || plugin.receipt.revision !== revision || plugin.readiness === 'blocked') throw new Error('Plugin revision changed; restart setup');
    const servers = materializePluginServers(plugin, this.store, [], true);
    return { ...config, mcp: { ...config.mcp, servers: { ...config.mcp?.servers, ...servers } } } as Config;
  }
  startPrepare(id: string, owner: string, revision: number, config: Config, workspace: string, idempotencyKey?: string): PluginSetupJob {
    const current = this.get(id, owner);
    if (idempotencyKey && current?.operations.some(op => op.key === idempotencyKey && op.action === 'prepare')) return current;
    if (!current || current.revision !== revision) throw new Error('Setup changed. Refresh and retry.');
    if (current.state === 'running') return current;
    if (lockfile.checkSync(this.path(id), { realpath: false })) throw new Error('Preparation is already running');
    void this.act(id, owner, { action: 'prepare', expectedRevision: revision, idempotencyKey }, config, workspace).catch(() => {
      log.warn({ pluginId: id }, 'Plugin preparation could not continue');
    });
    return this.get(id, owner)!;
  }
  /** Recheck an installed revision without login prompts or resource downloads. */
  async refreshRuntime(id: string, config: Config, workspace: string): Promise<void> {
    if (!existsSync(this.path(id)) || this.store.pending(id)) return;
    const saved = schema.parse(JSON.parse(readFileSync(this.path(id), 'utf8')));
    if (saved.packageRevision !== this.store.receipt(id)?.revision || !saved.installed || saved.resources !== 'ready'
      || !saved.connections.some(value => value.state === 'connected') && !saved.authorizations.some(value => value.state === 'connected')
      || saved.state === 'cancelled' || running.has(this.key(id)) || lockfile.checkSync(this.path(id), { realpath: false })) return;
    const release = lockfile.lockSync(this.path(id), { realpath: false });
    try { await this.perform(id, saved.owner, { action: 'prepare', expectedRevision: saved.revision }, config, workspace, true); }
    finally { release(); }
  }
  async act(id: string, owner: string, input: z.infer<typeof setupActionSchema>, config: Config, workspace: string): Promise<PluginSetupJob> {
    const current = this.get(id, owner);
    const previous = input.idempotencyKey && current?.operations.find(op => op.key === input.idempotencyKey);
    if (previous) {
      if (previous.action !== input.action) throw new Error('Idempotency key belongs to another action');
      return current!;
    }
    const remember = (job: PluginSetupJob) => {
      if (input.idempotencyKey && (job.state !== 'cancelled' || input.action === 'cancel')) {
        job.operations = [...job.operations, { key: input.idempotencyKey, action: input.action }].slice(-100); this.write(job);
      }
      return job;
    };
    if (input.action === 'cancel') return remember(await this.perform(id, owner, input, config, workspace));
    const release = lockfile.lockSync(this.path(id), { realpath: false });
    try { return remember(await this.perform(id, owner, input, config, workspace)); }
    finally { release(); }
  }
  private async perform(id: string, owner: string, input: z.infer<typeof setupActionSchema>, config: Config, workspace: string, refreshOnly = false): Promise<PluginSetupJob> {
    const job = this.get(id, owner); if (!job) throw new Error('Setup not found');
    if (job.revision !== input.expectedRevision) throw new Error('Setup changed. Refresh and retry.');
    if (input.action === 'cancel') {
      running.get(this.key(id))?.abort();
      cancelPluginCliAuthorizations(id, owner);
      for (const server of job.connections) if (server.authorizationId) cancelMcpAuthorization(server.authorizationId, owner);
      job.state = 'cancelled'; this.write(job); this.store.discardPending(id); return job;
    }
    if (running.has(this.key(id))) throw new Error('Preparation is already running');
    if (job.state === 'cancelled') throw new Error('Restart setup before continuing');
    const effective = this.config(id, job.packageRevision, config);
    const plugin = this.store.pending(id) ?? this.store.get(id)!;
    const declarations = pluginAuthorizations(plugin.manifest);
    if (input.action === 'configure') {
      const controller = new AbortController(); running.set(this.key(id), controller);
      try {
        if (input.authorization || input.method) {
          const declaration = declarations.find(value => value.id === input.authorization);
          const method = declaration?.methods.find(value => value.id === input.method);
          if ((!method || !('fields' in method)) || Object.keys(input.values).some(key => !method.fields.includes(key))) throw new Error('Invalid credential form');
          const saved = readPluginUserConfig(this.store, id, plugin.receipt.revision);
          if (method.fields.some(key => input.values[key] === undefined && saved[key] === undefined || typeof input.values[key] === 'string' && !(input.values[key] as string).trim())) throw new Error('Complete the required credential fields');
          const target = job.authorizations.find(value => value.id === declaration!.id)!;
          target.method = method.id; target.state = 'pending'; delete target.attemptId;
        }
        cancelPluginCliAuthorizations(id, owner);
        await savePluginUserConfig(this.store, plugin, input.values);
        controller.signal.throwIfAborted(); this.config(id, job.packageRevision, config);
        for (const server of job.connections) {
          if (input.authorization && !declarations.find(value => value.id === input.authorization)?.servers.includes(server.name)) continue;
          if (server.authorizationId) cancelMcpAuthorization(server.authorizationId, owner); server.state = 'pending'; delete server.authorizationId;
        }
        job.missingConfig = pluginConfigMissing(this.store, plugin);
        job.state = 'action_required'; this.write(job); return job;
      } finally { running.delete(this.key(id)); }
    }
    if (input.action === 'reuse') {
      const source = config.mcp?.servers?.[input.sourceServerId];
      const candidates = await this.reusableConnections(id, owner, config);
      if (!source?.xopcOAuthCredentialId || !candidates[input.server]?.some(value => value.id === input.sourceServerId)) throw new Error('This connection is unavailable or has different endpoint or OAuth scopes');
      if (this.get(id, owner)?.revision !== job.revision) throw new Error('Setup changed. Refresh and retry.');
      savePluginOAuthReference(this.store, id, input.server, { sourceServerId: input.sourceServerId, credentialId: source.xopcOAuthCredentialId, fingerprint: connectionFingerprint(source) });
      const server = job.connections.find(value => value.name === input.server)!;
      if (server.authorizationId) cancelMcpAuthorization(server.authorizationId, owner);
      server.state = 'pending'; delete server.authorizationId; job.state = 'action_required'; this.write(job); return job;
    }
    if (input.action === 'authorize') {
      const declaration = declarations.find(value => value.id === input.server);
      const method = declaration?.methods.find(value => value.id === input.method);
      if (declaration && !method) throw new Error('Choose an authorization method');
      if (method?.type === 'form') throw new Error('Complete this method using its credential form');
      if (declaration && method) {
        if (job.resources !== 'ready') throw new Error('Prepare resources before signing in');
        const target = job.authorizations.find(value => value.id === declaration.id)!;
        target.method = method.id; target.state = 'pending';
        for (const server of job.connections) if (declaration.servers.includes(server.name)) { if (server.authorizationId) cancelMcpAuthorization(server.authorizationId, owner); server.state = 'pending'; delete server.authorizationId; }
        if (method.type === 'cli') {
          const attempt = startPluginCliAuthorization(this.store, plugin, declaration.id, method, owner);
          target.attemptId = attempt.id; job.state = 'action_required'; this.write(job); return job;
        }
      }
      const server = job.connections.find(c => c.name === (method?.type === 'oauth' ? method.server : input.server)); if (!server) throw new Error('Unknown setup connection');
      const target = plugin.servers[server.name];
      if (target && readPluginAuthBinding(this.store, id, server.name, target, plugin.receipt.revision)?.oauthReference) await savePluginAuthBinding(this.store, id, server.name, { mode: 'auto' });
      if (this.get(id, owner)?.revision !== job.revision) throw new Error('Setup changed. Refresh and retry.');
      const attempt = startMcpAuthorization(this.config(id, job.packageRevision, config), workspace, pluginServerId(id, server.name), owner, { authorizationScope: `${job.id}:${server.name}` });
      server.authorizationId = attempt.id; job.state = 'action_required'; this.write(job); return job;
    }
    if (input.action === 'complete' || input.action === 'defer') {
      const deferred = input.action === 'defer';
      if (job.resources !== 'ready' || !deferred && pluginConfigMissing(this.store, plugin).length) throw new Error('Prepare resources and configuration first');
      const partial = plugin.diagnostics.length > 0 || job.connections.some(c => c.state !== 'connected') || job.authorizations.some(value => value.state !== 'connected') || pluginConfigMissing(this.store, plugin).length > 0;
      if (partial && !deferred && !('allowPartial' in input && input.allowPartial)) throw new Error('Some capabilities are unavailable. Review before enabling partially.');
      if (plugin.layout?.compatibility.some(item => item.component === 'hooks')) throw new Error('Lifecycle hooks are not supported; keep this plugin installed and disabled until a compatible adapter is available');
      this.store.commitPending(id);
      this.store.setWorkspaceScope(id, 'workspacePaths' in input ? input.workspacePaths : undefined);
      this.store.setEnabled(id, true);
      if (deferred) { delete job.error; cancelPluginCliAuthorizations(id, owner); for (const server of job.connections) if (server.authorizationId && server.state !== 'connected') cancelMcpAuthorization(server.authorizationId, owner); }
      job.installed = true; job.deferred = deferred && partial; job.partial = partial; job.state = 'completed'; this.write(job); return job;
    }
    const controller = new AbortController(); running.set(this.key(id), controller);
    const cancellationPoll = setInterval(() => {
      try { const current = this.get(id, owner); if (!current || current.id !== job.id || current.revision !== job.revision || current.state === 'cancelled' || !this.store.receipt(id)) controller.abort(); } catch { controller.abort(); }
    }, 500);
    cancellationPoll.unref();
    job.state = 'running'; job.resources = 'running'; delete job.error; this.write(job);
    try {
      if (!refreshOnly) await preparePluginResources(this.store, plugin, controller.signal);
      job.resources = 'ready';
      job.missingConfig = pluginConfigMissing(this.store, plugin);
      if (job.missingConfig.length) { job.state = 'action_required'; job.error = 'Complete the required configuration fields.'; }
      {
        for (const target of job.authorizations) {
          const declaration = declarations.find(value => value.id === target.id)!;
          const method = declaration.methods.find(value => value.id === target.method);
          if (method?.type === 'cli' && method.fields.some(key => job.missingConfig.includes(key))) { target.state = 'pending'; continue; }
          if (method?.type === 'cli') {
            const check = await inspectPluginCliAuthorization(this.store, plugin, target.id, method, controller.signal);
            target.state = check.authenticated && (check.expiresAt === undefined || check.expiresAt > Date.now()) ? 'connected' : 'pending'; target.issues = check.issues; target.expiresAt = check.expiresAt;
          }
          else if (method?.type === 'form') {
            const values = readPluginUserConfig(this.store, id, plugin.receipt.revision);
            target.state = method.fields.every(key => values[key] !== undefined && values[key] !== '') ? 'connected' : 'pending';
          }
        }
        for (const server of job.connections) {
          controller.signal.throwIfAborted();
          const gates = declarations.filter(value => value.servers.includes(server.name));
          const unavailable = gates.some(gate => { const target = job.authorizations.find(value => value.id === gate.id)!; const method = gate.methods.find(value => value.id === target.method); return !method || method.type !== 'oauth' && target.state !== 'connected'; });
          const missingServerConfig = job.missingConfig.some(key => JSON.stringify(plugin.servers[server.name]).includes(`\${user_config.${key}}`));
          if (unavailable || missingServerConfig) { server.state = 'skipped'; delete server.toolCount; continue; }
          const result = await probeMcpConnection(effective, workspace, pluginServerId(id, server.name), { signal: controller.signal });
          controller.signal.throwIfAborted();
          server.state = result.state; server.toolCount = result.toolCount;
          const persisted = this.get(id, owner);
          if (!persisted || persisted.id !== job.id || persisted.revision !== job.revision || persisted.state === 'cancelled' || !this.store.receipt(id)) throw new Error('Setup changed');
          this.config(id, job.packageRevision, config); this.write(job);
        }
        for (const target of job.authorizations) {
          const declaration = declarations.find(value => value.id === target.id)!;
          const method = declaration.methods.find(value => value.id === target.method);
          target.state = (method?.type === 'oauth' || target.state === 'connected') && declaration.servers.every(name => job.connections.find(value => value.name === name)?.state === 'connected') ? 'connected' : 'pending';
        }
        job.partial = plugin.diagnostics.length > 0;
        if (job.connections.some(value => value.state === 'error')) job.error = 'Connection verification failed. Check the credentials or login status and try again.';
        job.state = 'action_required';
      }
      this.config(id, job.packageRevision, config);
      controller.signal.throwIfAborted();
      if (this.get(id, owner)?.id !== job.id || this.get(id, owner)?.state === 'cancelled') throw new Error('Setup changed');
      this.write(job);
    } catch {
      const current = this.get(id, owner);
      if (!controller.signal.aborted && current?.id === job.id && current.revision === job.revision && current.state !== 'cancelled' && (this.store.pending(id) ?? this.store.get(id))?.receipt.revision === job.packageRevision) {
        for (const target of job.authorizations) target.state = 'pending';
        for (const connection of job.connections) {
          const server = plugin.servers[connection.name];
          const privateServer = server && (server.type !== 'stdio' ? server.connectionAuth?.mode !== 'none'
            : Object.values(server.env ?? {}).some(value => Object.entries(plugin.layout?.userConfig ?? {}).some(([key, field]) => field.sensitive && value.includes(`\${user_config.${key}}`))));
          if (privateServer) { connection.state = 'error'; delete connection.toolCount; }
        }
        job.state = 'failed'; if (job.resources !== 'ready') job.resources = 'error'; job.error = 'Preparation failed. Retry after checking resources and connections.'; this.write(job);
      }
    } finally { clearInterval(cancellationPoll); running.delete(this.key(id)); }
    const latest = this.get(id, owner);
    if (!latest) throw new Error('Setup was removed');
    return latest;
  }
}
