import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import { weixinSetupScope, type WeixinSetupScope } from './weixin-setup-scope.js';
import { CredentialResolver } from '../../auth/credentials.js';
import type { Config } from '../../config/schema.js';
import { connectorPrincipalForSession } from '../../connectors/principal.js';
import { connectorSecretProviderId } from '../../connectors/secret-store.js';
import { isManagedConnectorServer } from '../../connectors/materialize.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { getActiveConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { createLogger } from '../../utils/logger.js';
import { McpConnectionDrafts, McpDraftError, mcpConfigRevision } from './connection-drafts.js';
import { classifyMcpConnectionError } from './connection-errors.js';

const identity = z.string().min(1).max(200);
const log = createLogger('McpConversationSetup');
const targetSchema = z.object({ serverId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  displayName: z.string().min(1).max(100).optional(),
  url: z.string().url().max(2048), purpose: z.string().min(1).max(1000), expectedRevision: z.string().optional() }).strict();
const setupSchema = z.object({ setupId: identity, expectedVersion: z.number().int().positive().optional() }).strict();
const serverSchema = z.object({ serverId: identity, expectedRevision: z.string(), enabled: z.boolean().optional() }).strict();
function configuredServer(config: Config, id: string) {
  const servers = config.mcp?.servers;
  return servers && Object.hasOwn(servers, id) ? servers[id] : undefined;
}
type Phase = 'approval_required' | 'planned' | 'oauth_required' | 'authorizing' | 'token_required' | 'blocked' | 'ready' | 'cancelled';
type Goal = { id: string; conversationId: string; transcriptId: string; agentId: string; serverId: string; url: string;
  displayName?: string; reply?: { runId: string; text: string; status: 'pending' | 'failed' | 'delivered' }; channel?: WeixinSetupScope; approvedBy?: string; callbackConsumedForAttempt?: string;
  purpose: string; expectedRevision: string; version: number; phase: Phase; expiresAt: number;
  tokenProvider?: string; committedRevision?: string; reloadRequired?: boolean; resumed?: boolean; errorCode?: string };
export type McpSetupContext = { conversationId: string; agentId: string; canConfigure: boolean; canRequestWeixinSetup?: boolean };
type Save = (next: Config, expected?: Config) => Promise<{ saved: boolean; persisted?: boolean; conflict?: boolean }>;

/** Coordinates HTTP MCP setup; pi remains the sole MCP and OAuth implementation. */
export class McpConversationSetup {
  private readonly goals = new DurableState<Goal>('mcp.conversation-setup');
  private readonly drafts: McpConnectionDrafts;
  private readonly draftIds = new Map<string, string>();
  private readonly busy = new Set<string>();
  private readonly authorizations = new Set<string>();
  private disposed = false;
  constructor(private readonly options: { readConfig: () => Config; saveConfig: Save;
    changed?: (conversationId: string) => void;
    deliver?: (channel: WeixinSetupScope, text: string, setupId: string) => Promise<void>;
    withConfigLock: <T>(operation: () => Promise<T>) => Promise<T>;
    resume: (goal: { id: string; conversationId: string; transcriptId: string; serverId: string; purpose: string; channel?: WeixinSetupScope }) => Promise<boolean> }) {
    this.drafts = new McpConnectionDrafts({ readConfig: options.readConfig, saveConfig: options.saveConfig });
  }

  private notify(goal: Goal) {
    try { this.options.changed?.(goal.conversationId); }
    catch (err) { log.warn({ err, conversationId: goal.conversationId }, 'MCP setup state saved; notification failed'); }
  }
  private save(goal: Goal) { goal.version++; this.goals.set(goal.id, goal); this.notify(goal); }
  private current(goal: Goal) {
    if (this.disposed) throw new McpDraftError(409, 'Gateway is stopping. Recheck after restart.');
    const stored = this.goals.get(goal.id);
    const session = getSessionMetadata(goal.conversationId);
    const channel = goal.channel ? weixinSetupScope(goal.conversationId, this.options.readConfig()) : undefined;
    if (goal.channel && JSON.stringify(channel) !== JSON.stringify(goal.channel)) {
      if (stored && stored.phase !== 'cancelled') this.cancelGoal(stored);
      throw new McpDraftError(409, 'The Weixin identity, pairing or secure Gateway origin changed. Start a new request.');
    }
    if (!stored || stored.version !== goal.version || stored.phase === 'cancelled'
      || session?.transcriptId !== goal.transcriptId || session.agentId !== goal.agentId) {
      throw new McpDraftError(409, 'The setup objective changed or was cancelled. Inspect the current conversation before continuing.');
    }
  }
  private get(id: string, conversationId?: string) {
    const goal = this.goals.get(id);
    if (!goal || conversationId && goal.conversationId !== conversationId) throw new McpDraftError(404, 'MCP setup not found.');
    return goal;
  }
  private view(goal: Goal) {
    const expired = goal.expiresAt < Date.now() && goal.phase !== 'ready';
    return { setupId: goal.id, serverId: goal.serverId, displayName: goal.displayName, version: goal.version, phase: goal.phase,
      expired, reloadRequired: goal.reloadRequired === true,
      errorCode: goal.errorCode, conversationId: goal.conversationId, expiresAt: goal.expiresAt,
      interactionPath: goal.channel ? `${goal.channel.origin}/#/mcp-setup/${goal.id}` : `/mcp-setup/${goal.id}`,
      returnChannel: goal.channel ? 'weixin' : undefined, managementPath: goal.channel ? `${goal.channel.origin}/#/capabilities/connectors?tab=connected` : '/capabilities/connectors?tab=connected',
      continuationQueued: goal.resumed === true, replyDelivery: goal.reply?.status,
      instruction: goal.phase === 'cancelled' ? 'This setup is cancelled. Do not continue or revive it. Cancellation does not undo configuration already saved.'
        : expired ? 'This request expired. Start a new objective instead of reusing authorization.'
        : goal.phase === 'approval_required' ? 'Send the exact trusted interactionPath to the user. The paired Weixin user has requested this service; an authenticated Gateway owner must approve this exact request on that page before any probe, credential submission or configuration change. Never ask for keys, callback URLs or a continue reply in chat. The result returns to this original Weixin conversation automatically.'
        : goal.phase === 'blocked' ? 'The connection check failed. Report the safe error code and the remaining blocker. Do not repeatedly retry without resolving the cause.'
        : goal.reloadRequired ? 'Configuration is saved but runtime reload failed. Report the partial result and require a Gateway restart; do not claim the tools are active or tested.'
        : goal.phase === 'ready' ? 'Configuration is saved. The host continues the original objective in a fresh turn so native MCP tools can load. Stop this turn; do not repeat installation or invent a successful read.'
        : goal.phase === 'planned' ? 'Continue automatic steps with advance and the returned version.'
        : 'Link the trusted interactionPath for authorization or Token input, then stop this turn. The host resumes automatically; never ask for credentials, callback URLs or a continue reply in chat.' };
  }
  private cancelGoal(goal: Goal) {
    goal.phase = 'cancelled'; this.save(goal);
    const draftId = this.draftIds.get(goal.id);
    if (draftId) { try { this.drafts.remove('local-owner', draftId); } catch { /* The tombstone prevents late commits even during an in-flight operation. */ } }
    this.draftIds.delete(goal.id);
    return this.view(goal);
  }
  revokeWeixinRequests(accountId: string, peerId: string) {
    for (const goal of this.goals.values()) {
      if (goal.channel?.accountId === accountId && goal.channel.peerId.toLowerCase() === peerId.toLowerCase() && goal.phase !== 'cancelled') this.cancelGoal(goal);
    }
  }
  reconcileWeixinScopes() {
    for (const goal of this.goals.values().filter(item => item.channel && item.phase !== 'cancelled')) {
      try { this.current(goal); } catch { /* Observed scope revocation persists a cancellation tombstone. */ }
    }
  }
  private inspect() {
    return { servers: Object.entries(this.options.readConfig().mcp?.servers ?? {}).map(([serverId, server]) => ({
      serverId, displayName: server.displayName, enabled: server.enabled !== false, transport: server.command ? 'stdio' : 'http',
      managed: isManagedConnectorServer(server) || Boolean(server.xopcPlugin), revision: mcpConfigRevision(server),
      // Never expose configured URLs, headers, environment values or OAuth material to the model.
      hasCredentialReference: Boolean(server.auth || server.headers || server.xopcOAuthCredentialId),
    })), managementPath: '/capabilities/connectors?tab=connected' };
  }
  currentForConversation(conversationId: string) {
    const session = getSessionMetadata(conversationId);
    if (!session) return { setup: null };
    const goal = this.goals.values(undefined, true).find(item => item.conversationId === conversationId && item.transcriptId === session.transcriptId
      && item.agentId === session.agentId && item.phase !== 'cancelled' && (item.phase !== 'ready' || !item.resumed || item.reloadRequired));
    return { setup: goal ? this.view(goal) : null };
  }

  async command(command: string, input: Record<string, unknown>, context: McpSetupContext, dryRun = false): Promise<unknown> {
    const activeSession = getSessionMetadata(context.conversationId);
    if (!activeSession || activeSession.agentId !== context.agentId) throw new McpDraftError(404, 'Owner conversation required.');
    const localOwner = connectorPrincipalForSession(context.conversationId).isLocalOwner;
    const channel = context.canRequestWeixinSetup ? weixinSetupScope(context.conversationId, this.options.readConfig()) : undefined;
    if (!localOwner && !channel) throw new McpDraftError(404, 'A paired, account-isolated Weixin direct conversation and a secure Gateway public URL are required. Shared/merged routing is not eligible.');
    if (channel && !['start', 'get', 'cancel', 'advance'].includes(command)) throw new McpDraftError(409, 'Weixin configuration requires approval for a specific new connection on the secure page.');
    if (command === 'inspect') { z.object({}).strict().parse(input); return this.inspect(); }
    if (command === 'get') { const args = setupSchema.parse(input); return this.view(this.get(args.setupId, context.conversationId)); }
    if (!context.canConfigure && !channel) throw new McpDraftError(409, 'An active owner App or local CLI turn is required for MCP configuration.');
    if (command === 'start') {
      const waiting = getActiveConnectionWait(context.conversationId);
      if (waiting) throw new McpDraftError(409, 'Another connection objective is waiting. Finish or cancel it before starting a separate MCP setup.');
      const args = targetSchema.parse(input), url = new URL(args.url);
      if (['__proto__', 'constructor', 'prototype'].includes(args.serverId.toLowerCase())) throw new McpDraftError(400, 'Use a non-reserved server name.');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization/i.test(key))) {
        throw new McpDraftError(400, 'Use an HTTP MCP address without embedded credentials. Enter secrets only in the secure page.');
      }
      const session = getSessionMetadata(context.conversationId);
      if (!session?.transcriptId || session.agentId !== context.agentId) throw new McpDraftError(409, 'Conversation identity changed.');
      if (channel) {
        if (args.expectedRevision !== undefined) throw new McpDraftError(409, 'Existing connection changes require owner management.');
        args.displayName ??= args.serverId;
        args.serverId = `weixin-${createHash('sha256').update(`${channel.principalId}\0${url.href}`).digest('hex').slice(0, 16)}`;
      }
      const server = configuredServer(this.options.readConfig(), args.serverId);
      if (channel && server?.enabled !== false && server?.url === url.href && !isManagedConnectorServer(server) && !server.xopcPlugin) {
        return { alreadyConfigured: true, serverId: args.serverId, displayName: server.displayName,
          instruction: 'This exact service is already saved. Discover its actual native tools and complete the current read without another configuration. Runtime readiness and the business result still need an actual tool call.' };
      }
      if (channel && server) throw new McpDraftError(409, 'Replacing an existing connection requires its owner management page.');
      if (server && args.expectedRevision !== mcpConfigRevision(server)) throw new McpDraftError(409, 'Read inspect and provide the current server revision before replacing it.');
      if (server && (isManagedConnectorServer(server) || server.xopcPlugin)) throw new McpDraftError(409, 'Manage this service through its owning connector or plugin.');
      if (dryRun) return { dryRun: true, serverId: args.serverId, authentication: 'probe_required' };
      const existing = this.goals.values().find(goal => goal.conversationId === context.conversationId && goal.transcriptId === session.transcriptId
        && goal.serverId === args.serverId && goal.url === url.href && goal.purpose === args.purpose && goal.displayName === args.displayName && goal.phase !== 'cancelled' && goal.phase !== 'ready' && goal.expiresAt > Date.now());
      if (existing) return this.view(existing);
      for (const previous of this.goals.values().filter(item => item.conversationId === context.conversationId && (item.phase !== 'ready' || !item.resumed) && item.phase !== 'cancelled')) {
        previous.phase = 'cancelled'; this.save(previous);
      }
      const goal: Goal = { id: randomUUID(), conversationId: context.conversationId, transcriptId: session.transcriptId,
        agentId: context.agentId, serverId: args.serverId, displayName: args.displayName, url: url.href, purpose: args.purpose,
        expectedRevision: mcpConfigRevision(server), version: 1, phase: channel ? 'approval_required' : 'planned', ...(channel ? { channel } : {}), expiresAt: Date.now() + 15 * 60_000 };
      this.goals.set(goal.id, goal); this.notify(goal); return this.view(goal);
    }
    if (command === 'remove' || command === 'set_enabled') {
      const args = serverSchema.parse(input);
      if (command === 'set_enabled' && args.enabled === undefined) throw new McpDraftError(400, 'enabled is required.');
      if (dryRun) return { dryRun: true, serverId: args.serverId };
      return this.options.withConfigLock(async () => {
        const config = this.options.readConfig(), server = configuredServer(config, args.serverId);
        if (!server || isManagedConnectorServer(server) || server.xopcPlugin || mcpConfigRevision(server) !== args.expectedRevision) throw new McpDraftError(409, 'The custom server changed or belongs to another owner. Inspect again.');
        for (const goal of this.goals.values().filter(item => item.serverId === args.serverId && item.phase !== 'ready' && item.phase !== 'cancelled')) { goal.phase = 'cancelled'; this.save(goal); }
        const next = structuredClone(config);
        if (command === 'remove') delete next.mcp!.servers![args.serverId];
        else next.mcp!.servers![args.serverId].enabled = args.enabled;
        const result = await this.options.saveConfig(next, structuredClone(config));
        if (result.conflict || !result.saved && !result.persisted) throw new McpDraftError(409, 'Configuration could not be applied. Inspect before retrying.');
        return { saved: true, removed: command === 'remove', enabled: command === 'set_enabled' ? args.enabled : undefined,
          reloadRequired: !result.saved, remoteAuthorizationRevoked: false, instruction: 'This changes local configuration only. Remote authorization and installed packages are not removed.' };
      });
    }
    const args = setupSchema.parse(input), goal = this.get(args.setupId, context.conversationId);
    if (!['advance', 'cancel'].includes(command)) throw new McpDraftError(400, 'Supported MCP setup commands: inspect, start, get, advance, cancel, set_enabled, remove.');
    if (args.expectedVersion !== goal.version) throw new McpDraftError(409, 'Setup changed. Read get before retrying.');
    if (dryRun) return { dryRun: true, ...this.view(goal) };
    if (command === 'cancel') return this.cancelGoal(goal);
    return this.advance(goal);
  }

  private async advance(goal: Goal) {
    this.current(goal);
    if (goal.phase === 'approval_required') return this.view(goal);
    if (goal.channel && !goal.approvedBy) throw new McpDraftError(409, 'Owner approval is required.');
    if (goal.phase === 'ready') { await this.resume(goal); return this.view(goal); }
    if (goal.expiresAt < Date.now()) throw new McpDraftError(409, 'Setup expired. Start a new goal; do not reuse an old authorization.');
    if (this.busy.has(goal.id)) return { ...this.view(goal), inProgress: true };
    this.busy.add(goal.id);
    try {
      const config = this.options.readConfig(), published = configuredServer(config, goal.serverId);
      if (published?.xopcSetupId === goal.id) {
        goal.phase = 'ready'; goal.committedRevision = mcpConfigRevision(published); this.save(goal); await this.resume(goal); return this.view(goal);
      }
      if (mcpConfigRevision(published) !== goal.expectedRevision) throw new McpDraftError(409, 'Server changed. Start again from the current configuration.');
      let draftId = this.draftIds.get(goal.id);
      if (!draftId) {
        const draft = await this.drafts.create('local-owner', { serverId: goal.serverId,
          ...(published ? { sourceServerId: goal.serverId, expectedServer: published } : {}),
          server: { url: goal.url, displayName: goal.displayName, type: 'streamable-http', enabled: true, xopcSetupId: goal.id,
            ...(goal.tokenProvider ? { headers: { Authorization: { xopcSecretRef: { provider: goal.tokenProvider, fieldKey: 'token', prefix: 'Bearer ' } } } } : {}) } });
        this.current(goal); draftId = draft.id; this.draftIds.set(goal.id, draftId);
        if (goal.phase === 'authorizing') { goal.phase = 'planned'; this.save(goal); }
      }
      if (goal.phase === 'authorizing') {
        const auth = this.drafts.authorization('local-owner', draftId);
        if (auth.state === 'error' || auth.state === 'cancelled') { goal.phase = 'blocked'; goal.errorCode = 'authorization_failed'; this.save(goal); return this.view(goal); }
        if (auth.state !== 'connected') return this.view(goal);
      } else {
        const probe = await this.drafts.probe('local-owner', draftId); this.current(goal);
        if (probe.state !== 'connected') {
          goal.phase = probe.state === 'error' ? 'blocked' : probe.state;
          goal.errorCode = probe.state === 'token_required' && goal.tokenProvider ? 'credential_rejected' : probe.errorCode; this.save(goal); return this.view(goal);
        }
      }
      const result = await this.options.withConfigLock(async () => { this.current(goal); return this.drafts.commit('local-owner', draftId!, true); });
      goal.phase = 'ready'; goal.errorCode = undefined; goal.reloadRequired = result.reloadRequired === true;
      goal.committedRevision = mcpConfigRevision(configuredServer(this.options.readConfig(), goal.serverId));
      this.current(goal); this.save(goal); this.draftIds.delete(goal.id);
      await this.resume(goal); return this.view(goal);
    } catch (error) {
      this.current(goal);
      if (error instanceof McpDraftError) {
        if (error.status === 404) { this.draftIds.delete(goal.id); goal.phase = 'planned'; this.save(goal); return { ...this.view(goal), requiresRecheck: true }; }
        throw error;
      }
      goal.phase = 'blocked'; goal.errorCode = classifyMcpConnectionError(error); this.save(goal);
      return this.view(goal);
    } finally { this.busy.delete(goal.id); }
  }

  /** Owner-only UI; secret values and OAuth URLs never pass through the model API. */
  async interact(id: string, action: 'get' | 'advance' | 'token' | 'authorize' | 'cancel' | 'approve' | 'retry_delivery', value?: string, expectedVersion?: number, ownerPrincipalId = 'local-owner') {
    const goal = this.get(id);
    if (!goal.channel && !connectorPrincipalForSession(goal.conversationId).isLocalOwner) throw new McpDraftError(404, 'Owner conversation required.');
    if (action === 'get') {
      let authorizationUrl: string | undefined, authState: string | undefined;
      const session = getSessionMetadata(goal.conversationId);
      try { this.current(goal); } catch { return { ...this.view(goal), phase: 'cancelled', endpointOrigin: new URL(goal.url).origin }; }
      if (session?.transcriptId !== goal.transcriptId || session.agentId !== goal.agentId) {
        return { ...this.view(goal), phase: 'cancelled', endpointOrigin: new URL(goal.url).origin };
      }
      const draftId = this.draftIds.get(id);
      if (draftId && goal.phase === 'authorizing' && goal.expiresAt > Date.now()) {
        const auth = this.drafts.authorization('local-owner', draftId); authorizationUrl = auth.authorizationUrl; authState = auth.state;
      }
      return { ...this.view(goal), endpointOrigin: new URL(goal.url).origin, approval: goal.channel ? { ...goal.channel, endpoint: goal.url, purpose: goal.purpose } : undefined, canReplaceToken: Boolean(goal.tokenProvider), authorizationUrl, authState, requiresRecheck: !draftId && goal.phase !== 'ready' && goal.phase !== 'cancelled' };
    }
    this.current(goal);
    if (action === 'retry_delivery' && goal.channel && goal.phase === 'ready' && goal.reply?.status === 'delivered') return this.view(goal);
    if (expectedVersion !== goal.version) throw new McpDraftError(409, 'The secure form changed. Refresh before submitting.');
    if (action === 'cancel') return this.cancelGoal(goal);
    if (action === 'retry_delivery') {
      if (!goal.channel || goal.phase !== 'ready' || goal.reply?.status !== 'failed' || goal.expiresAt < Date.now()) throw new McpDraftError(409, 'This result cannot be resent.');
      await this.deliverReply(goal); return this.view(this.get(id));
    }
    if (goal.expiresAt < Date.now() || goal.phase === 'ready') throw new McpDraftError(409, 'This setup no longer accepts input.');
    if (action === 'approve') {
      if (!goal.channel || goal.phase !== 'approval_required' || !ownerPrincipalId) throw new McpDraftError(409, 'This request cannot be approved.');
      goal.approvedBy = ownerPrincipalId; goal.phase = 'planned'; this.save(goal); return this.advance(goal);
    }
    if (goal.phase === 'approval_required') throw new McpDraftError(409, 'Approve the exact Weixin request before continuing.');
    if (action === 'token') {
      if (!(goal.phase === 'token_required' || goal.phase === 'blocked' && goal.tokenProvider) || !value?.trim() || value.length > 16384) throw new McpDraftError(400, 'A token is required for this setup.');
      if (this.busy.has(id)) throw new McpDraftError(409, 'A check is in progress.');
      const url = new URL(goal.url);
      if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new McpDraftError(400, 'Token authentication requires HTTPS or a loopback server.');
      // Claim this form version before any credential I/O so two submissions cannot overwrite it.
      this.busy.add(id); this.save(goal);
      const provider = connectorSecretProviderId(`mcp-setup-${id}-${goal.version}`, 'token');
      const credentials = new CredentialResolver();
      try {
        await credentials.saveApiKey(provider, value.trim()); this.current(goal);
        const old = this.draftIds.get(id);
        if (old) { try { this.drafts.remove('local-owner', old); } catch (error) { if (!(error instanceof McpDraftError) || error.status !== 404) throw error; } }
        this.draftIds.delete(id); goal.tokenProvider = provider; goal.phase = 'planned'; goal.errorCode = undefined; this.save(goal);
      } catch (error) { await credentials.deleteProfile(`${provider}:default`); throw error; }
      finally { this.busy.delete(id); }
    }
    if (action === 'authorize') {
      if (goal.phase !== 'oauth_required') throw new McpDraftError(409, 'Recheck the server before authorization.');
      const draftId = this.draftIds.get(id);
      if (!draftId) { goal.phase = 'planned'; this.save(goal); return this.advance(goal); }
      this.drafts.authorize('local-owner', draftId, goal.channel ? { callbackRelayUrl: `${goal.channel.origin}/mcp-setup/callback/${goal.id}` } : undefined); goal.phase = 'authorizing'; this.save(goal); this.settleAuthorization(goal.id); return this.view(goal);
    }
    return this.advance(goal);
  }

  private settleAuthorization(id: string) {
    if (this.authorizations.has(id)) return;
    this.authorizations.add(id);
    void (async () => {
      for (;;) {
        await delay(250, undefined, { ref: false });
        if (this.disposed) return;
        const goal = this.goals.get(id);
        if (!goal || goal.phase !== 'authorizing' || goal.expiresAt < Date.now()) return;
        this.current(goal);
        const draftId = this.draftIds.get(id);
        if (!draftId) return;
        const auth = this.drafts.authorization('local-owner', draftId);
        if (auth.state === 'connected') { await this.advance(goal); }
        else if (auth.state === 'error' || auth.state === 'cancelled') {
          goal.phase = 'blocked'; goal.errorCode = 'authorization_failed'; this.save(goal); return;
        }
      }
    })().catch(error => {
      try {
        if (this.disposed) return;
        const goal = this.goals.get(id);
        if (!goal || goal.phase !== 'authorizing') return;
        this.current(goal); goal.phase = 'blocked';
        goal.errorCode = error instanceof McpDraftError ? 'configuration_changed' : classifyMcpConnectionError(error);
        this.save(goal);
      } catch { /* Revoked, reset or closed runtime state must not continue. */ }
    })
      .finally(() => this.authorizations.delete(id));
  }

  dispose() {
    this.disposed = true;
    for (const draftId of this.draftIds.values()) {
      try { this.drafts.remove('local-owner', draftId); } catch { /* An in-flight commit is rechecked after restart. */ }
    }
    this.draftIds.clear();
  }

  relayCallback(id: string, callbackUrl: string): string {
    const goal = this.get(id); this.current(goal);
    if (!goal.channel || !goal.approvedBy || goal.phase !== 'authorizing' || goal.expiresAt < Date.now()) throw new McpDraftError(409, 'Authorization is no longer active.');
    const draftId = this.draftIds.get(id);
    if (!draftId) throw new McpDraftError(409, 'Sign in again after the Gateway restart.');
    const auth = this.drafts.authorization('local-owner', draftId);
    if (goal.callbackConsumedForAttempt === auth.id) throw new McpDraftError(409, 'Authorization response already received.');
    const actual = new URL(callbackUrl);
    if (actual.origin !== goal.channel.origin || actual.pathname !== `/mcp-setup/callback/${id}`) throw new McpDraftError(400, 'Invalid authorization callback.');
    this.drafts.redirect('local-owner', draftId, actual.href);
    goal.callbackConsumedForAttempt = auth.id; this.save(goal);
    return `/#/mcp-setup/${goal.id}`;
  }

  async completeContinuation(input: { conversationId: string; clientMessageId: string; expectedTranscriptId?: string;
    origin: { type: string; source?: string }; runId?: string }, text: string) {
    if (!input.runId || !this.permitsContinuation(input)) return;
    const goal = this.get(input.clientMessageId.slice('mcp-setup:'.length));
    if (!goal.channel || goal.reply || !text.trim()) return;
    goal.reply = { runId: input.runId, text, status: 'pending' }; this.save(goal);
    await this.deliverReply(goal);
  }
  private async deliverReply(goal: Goal) {
    if (!goal.channel || !goal.reply || goal.reply.status === 'delivered' || !this.options.deliver || this.busy.has(`reply:${goal.id}`)) return;
    this.current(goal);
    if (goal.phase !== 'ready' || goal.expiresAt < Date.now()) return;
    this.busy.add(`reply:${goal.id}`);
    try {
      await this.options.deliver(goal.channel, goal.reply.text, goal.id);
      const latest = this.get(goal.id); this.current(latest);
      if (latest.reply?.runId === goal.reply.runId) { latest.reply.status = 'delivered'; this.save(latest); }
    } catch {
      const latest = this.get(goal.id);
      if (latest.reply?.runId === goal.reply.runId && latest.phase === 'ready') { latest.reply.status = 'failed'; this.save(latest); }
    } finally { this.busy.delete(`reply:${goal.id}`); }
  }

  private async resume(goal: Goal) {
    this.current(goal);
    if (!goal.resumed && goal.expiresAt < Date.now()) { goal.phase = 'blocked'; goal.errorCode = 'scope_expired'; this.save(goal); return; }
    if (goal.resumed || goal.reloadRequired || mcpConfigRevision(configuredServer(this.options.readConfig(), goal.serverId)) !== goal.committedRevision) return;
    const queued = await this.options.resume(goal);
    const latest = this.goals.get(goal.id);
    if (latest && latest.committedRevision === goal.committedRevision && latest.phase === 'ready') {
      this.current(latest); Object.assign(goal, latest); if (latest.resumed) return;
    }
    this.current(goal);
    if (queued) { goal.resumed = true; this.save(goal); }
  }
  permitsContinuation(input: { conversationId: string; clientMessageId: string; expectedTranscriptId?: string; origin: { type: string; source?: string } }): boolean {
    if (!input.clientMessageId.startsWith('mcp-setup:')) return true;
    const goal = this.goals.get(input.clientMessageId.slice('mcp-setup:'.length));
    if (!goal || goal.phase !== 'ready' || goal.reloadRequired || goal.expiresAt < Date.now() || goal.conversationId !== input.conversationId
      || goal.transcriptId !== input.expectedTranscriptId || input.origin.type !== 'system' || input.origin.source !== 'internal') return false;
    try { this.current(goal); return mcpConfigRevision(configuredServer(this.options.readConfig(), goal.serverId)) === goal.committedRevision; }
    catch { return false; }
  }
  async resumePending(runtimeReloaded = false) {
    for (const goal of this.goals.values().filter(item => item.phase === 'ready' && item.reply && item.reply.status !== 'delivered')) {
      try { await this.deliverReply(goal); } catch { /* Revoked or reset destinations cannot receive old results. */ }
    }
    for (const goal of this.goals.values().filter(item => item.phase === 'ready' && !item.resumed)) {
      if (goal.reloadRequired && runtimeReloaded && mcpConfigRevision(configuredServer(this.options.readConfig(), goal.serverId)) === goal.committedRevision) {
        goal.reloadRequired = false; this.save(goal);
      }
      if (goal.reloadRequired) continue;
      try { await this.resume(goal); } catch { /* A reset or changed target cannot resume an old objective. */ }
    }
  }
}
