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
import { McpDiscovery, createMcpResearch, type McpResearch } from './discovery.js';
import { localExecutionSchema, secretFieldsSchema, type SetupSecretField, type LocalExecution } from './setup-plan.js';
import type { McpConnectionProbe } from './connection-setup.js';

const identity = z.string().min(1).max(200);
const log = createLogger('McpConversationSetup');
const targetSchema = z.object({ serverId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  displayName: z.string().min(1).max(100).optional(),
  url: z.string().url().max(2048).optional(), purpose: z.string().min(1).max(1000), authentication: z.enum(['auto', 'bearer', 'header', 'none']).optional(), expectedRevision: z.string().optional(),
  planId: z.string().uuid().optional(), expectedPlanVersion: z.number().int().positive().optional(), transport: z.enum(['streamable-http', 'sse', 'stdio']).optional(),
  secretFields: secretFieldsSchema.optional(), execution: localExecutionSchema.optional(), helpUrl: z.string().url().optional(), objective: z.enum(['connect_only', 'complete_task']).optional() }).strict();
const setupSchema = z.object({ setupId: identity, expectedVersion: z.number().int().positive().optional() }).strict();
const serverSchema = z.object({ serverId: identity, expectedRevision: z.string(), enabled: z.boolean().optional() }).strict();
function configuredServer(config: Config, id: string) {
  const servers = config.mcp?.servers;
  return servers && Object.hasOwn(servers, id) ? servers[id] : undefined;
}
type Phase = 'approval_required' | 'planned' | 'oauth_required' | 'authorizing' | 'token_required' | 'auth_unknown' | 'blocked' | 'ready' | 'cancelled';
type Goal = { id: string; conversationId: string; transcriptId: string; agentId: string; serverId: string; url: string;
  displayName?: string; reply?: { runId: string; text: string; status: 'pending' | 'failed' | 'delivered' }; channel?: WeixinSetupScope; approvedBy?: string; callbackConsumedForAttempt?: string;
  purpose: string; expectedRevision: string; version: number; phase: Phase; expiresAt: number;
  authentication?: 'auto' | 'bearer' | 'header' | 'none'; tokenProvider?: string; secretProviders?: Record<string, string>; secretFields?: SetupSecretField[];
  transport?: 'streamable-http' | 'sse' | 'stdio'; execution?: LocalExecution; helpUrl?: string; objective?: 'connect_only' | 'complete_task';
  reviewRequired?: boolean; publicOnly?: boolean; sources?: Array<{ url: string; hash: string }>;
  diagnosis?: Pick<McpConnectionProbe, 'auth' | 'recovery' | 'observation'>; attempts?: number; nextRetryAt?: number; requestCounts?: Record<string, number>;
  committedRevision?: string; reloadRequired?: boolean; resumed?: boolean; errorCode?: string };
export type McpSetupContext = { conversationId: string; agentId: string; canConfigure: boolean; canRequestWeixinSetup?: boolean;
  signal?: AbortSignal; authorizeResearch?: (tool: 'web_search' | 'web_fetch', args: Record<string, unknown>) => Promise<boolean> };
type Save = (next: Config, expected?: Config) => Promise<{ saved: boolean; persisted?: boolean; conflict?: boolean }>;

/** Coordinates HTTP MCP setup; pi remains the sole MCP and OAuth implementation. */
export class McpConversationSetup {
  private readonly goals = new DurableState<Goal>('mcp.conversation-setup');
  private readonly drafts: McpConnectionDrafts;
  private readonly draftIds = new Map<string, string>();
  private readonly busy = new Set<string>();
  private readonly authorizations = new Set<string>();
  private disposed = false;
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly discovery: McpDiscovery;
  constructor(private readonly options: { readConfig: () => Config; saveConfig: Save;
    research?: McpResearch;
    changed?: (conversationId: string) => void;
    deliver?: (channel: WeixinSetupScope, text: string, setupId: string) => Promise<void>;
    withConfigLock: <T>(operation: () => Promise<T>) => Promise<T>;
    resume: (goal: { id: string; conversationId: string; transcriptId: string; serverId: string; purpose: string; objective?: 'connect_only' | 'complete_task'; channel?: WeixinSetupScope }) => Promise<boolean> }) {
    this.drafts = new McpConnectionDrafts({ readConfig: options.readConfig, saveConfig: options.saveConfig });
    this.discovery = new McpDiscovery(options.research ?? createMcpResearch(options.readConfig));
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
  private canProvideToken(goal: Goal) {
    const url = new URL(goal.url);
    return (goal.phase === 'auth_unknown' || goal.phase === 'blocked' && goal.errorCode === 'access_denied') && !goal.tokenProvider && !goal.secretProviders
      && (url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  }
  private view(goal: Goal) {
    const expired = goal.expiresAt < Date.now() && goal.phase !== 'ready';
    const interactionPath = goal.channel ? `${goal.channel.origin}/#/mcp-setup/${goal.id}` : `/mcp-setup/${goal.id}`;
    const interactionLink = `[Complete connection](${interactionPath})`;
    return { setupId: goal.id, serverId: goal.serverId, displayName: goal.displayName, version: goal.version, phase: goal.phase,
      expired, reloadRequired: goal.reloadRequired === true, canProvideToken: this.canProvideToken(goal),
      secretFields: goal.secretFields, helpUrl: goal.helpUrl, objective: goal.objective,
      planApproval: goal.reviewRequired ? { sources: goal.sources ?? [], execution: goal.execution, endpoint: goal.transport === 'stdio' ? goal.execution?.command : goal.url, purpose: goal.purpose } : undefined,
      diagnosis: goal.diagnosis, nextRetryAt: goal.nextRetryAt, attempts: goal.attempts ?? 0,
      errorCode: goal.errorCode, conversationId: goal.conversationId, expiresAt: goal.expiresAt,
      interactionPath,
      returnChannel: goal.channel ? 'weixin' : undefined, managementPath: goal.channel ? `${goal.channel.origin}/#/capabilities/connectors?tab=connected` : '/capabilities/connectors?tab=connected',
      continuationQueued: goal.resumed === true, replyDelivery: goal.reply?.status,
      instruction: goal.phase === 'cancelled' ? 'This setup is cancelled. Do not continue or revive it. Cancellation does not undo configuration already saved.'
        : expired ? 'This request expired. Start a new objective instead of reusing authorization.'
        : goal.phase === 'approval_required' ? goal.channel
          ? 'Send the exact trusted interactionPath to the user. The paired Weixin user has requested this service; an authenticated Gateway owner must approve this exact request on that page before any probe, credential submission or configuration change. Never ask for keys, callback URLs or a continue reply in chat. The result returns to this original Weixin conversation automatically.'
          : `Copy ${interactionLink} verbatim. The owner must review this exact publisher source or local execution plan before any probe, credential submission or execution. Do not ask for secrets or an additional continue reply in chat.`
        : this.canProvideToken(goal) ? `The service refused access. Copy this Markdown link verbatim for secure first-time Token input: ${interactionLink} . Never rewrite its destination as xopc://workspace or add an origin. A refusal alone does not prove a missing Token; service or account permissions may also block access. Do not request secrets in chat or repeatedly retry.`
        : goal.phase === 'blocked' ? 'The connection check failed. Report the safe error code and the remaining blocker. Do not repeatedly retry without resolving the cause.'
        : goal.reloadRequired ? 'Configuration is saved but runtime reload failed. Report the partial result and require a Gateway restart; do not claim the tools are active or tested.'
        : goal.phase === 'ready' ? 'Configuration is saved. The host queues the original objective once in a fresh turn. If this is that continuation, discover native tools by the exact server namespace and finish the original objective; otherwise stop and let the queued continuation run. Do not repeat installation or invent a successful read.'
        : goal.phase === 'planned' ? 'Continue automatic steps with advance and the returned version.'
        : `Copy this Markdown link verbatim for authorization or Token input: ${interactionLink} . Never rewrite its destination as xopc://workspace or add an origin. Then stop this turn. The host resumes automatically; never ask for credentials, callback URLs or a continue reply in chat.` };
  }
  private cancelGoal(goal: Goal) {
    clearTimeout(this.retryTimers.get(goal.id)); this.retryTimers.delete(goal.id);
    goal.phase = 'cancelled'; this.save(goal);
    const draftId = this.draftIds.get(goal.id);
    if (draftId) { try { this.drafts.remove('local-owner', draftId); } catch { /* The tombstone prevents late commits even during an in-flight operation. */ } }
    this.draftIds.delete(goal.id);
    return this.view(goal);
  }
  async cancelConversation(conversationId: string) {
    this.discovery.cancelConversation(conversationId);
    for (const goal of this.goals.values().filter(g => g.conversationId === conversationId && g.phase !== 'cancelled')) this.cancelGoal(goal);
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
    if (channel && !['discover', 'propose', 'select', 'repair', 'start', 'get', 'cancel', 'advance'].includes(command)) throw new McpDraftError(409, 'Weixin configuration requires approval for a specific new connection on the secure page.');
    if (['discover', 'propose', 'select'].includes(command)) {
      if (!context.canConfigure && !channel) throw new McpDraftError(409, 'An active owner turn is required.');
      if (dryRun) return { dryRun: true, instruction: 'Discovery and candidate state were not changed.' };
      return this.discovery.command(command, input, context);
    }
    if (command === 'inspect') { z.object({}).strict().parse(input); return this.inspect(); }
    if (command === 'get') { const args = setupSchema.parse(input); return this.view(this.get(args.setupId, context.conversationId)); }
    if (!context.canConfigure && !channel) throw new McpDraftError(409, 'An active owner App or local CLI turn is required for MCP configuration.');
    if (command === 'repair') {
      const args = setupSchema.extend({ planId: z.string().uuid(), expectedPlanVersion: z.number().int().positive() }).strict().parse(input);
      const goal = this.get(args.setupId, context.conversationId); this.current(goal);
      if (goal.version !== args.expectedVersion || goal.expiresAt < Date.now() || goal.phase !== 'blocked' || goal.diagnosis?.recovery?.kind !== 'verify_documented_endpoint') throw new McpDraftError(409, 'This objective does not permit endpoint repair.');
      const selected = this.discovery.selected(args.planId, args.expectedPlanVersion, context);
      if (selected.purpose !== goal.purpose || selected.plan.url === goal.url && (selected.plan.transport ?? 'streamable-http') === (goal.transport ?? 'streamable-http')) throw new McpDraftError(409, 'Repair needs the original objective and a documented different endpoint or transport.');
      if (dryRun) return { dryRun: true, instruction: 'The original objective and all existing credentials remain unchanged.' };
      const revision = mcpConfigRevision(configuredServer(this.options.readConfig(), goal.serverId));
      if (revision !== goal.expectedRevision) throw new McpDraftError(409, 'The saved connection changed. Inspect before repairing.');
      this.cancelGoal(goal);
      return this.command('start', { planId: args.planId, expectedPlanVersion: args.expectedPlanVersion, serverId: goal.serverId, purpose: goal.purpose, ...(!channel ? { expectedRevision: revision } : {}) }, context);
    }
    if (command === 'start') {
      const waiting = getActiveConnectionWait(context.conversationId);
      if (waiting) throw new McpDraftError(409, 'Another connection objective is waiting. Finish or cancel it before starting a separate MCP setup.');
      const args = targetSchema.parse(input);
      let selected: ReturnType<McpDiscovery['selected']> | undefined;
      if (args.planId) {
        if (!args.expectedPlanVersion || args.url || args.execution || args.authentication || args.secretFields || args.transport || args.helpUrl || args.objective) throw new McpDraftError(400, 'Use the selected plan without overriding its configuration.');
        selected = this.discovery.selected(args.planId, args.expectedPlanVersion, context); Object.assign(args, selected.plan); args.purpose = selected.purpose;
      }
      const stdio = args.transport === 'stdio';
      for (const reference of [args.helpUrl, args.execution?.sourceUrl].filter((v): v is string => Boolean(v))) {
        const parsed = new URL(reference);
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || [...parsed.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization/i.test(key))) throw new McpDraftError(400, 'Use a public integration guide without embedded credentials.');
      }
      if (stdio ? !args.execution || args.url : !args.url || args.execution) throw new McpDraftError(400, 'Provide one HTTP URL or stdio execution plan.');
      const url = new URL(stdio ? `stdio://localhost/${args.serverId}` : args.url!);
      if (['__proto__', 'constructor', 'prototype'].includes(args.serverId.toLowerCase())) throw new McpDraftError(400, 'Use a non-reserved server name.');
      if (!stdio && (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization/i.test(key)))) {
        throw new McpDraftError(400, 'Use an HTTP MCP address without embedded credentials. Enter secrets only in the secure page.');
      }
      if (args.secretFields?.some(field => field.location !== (stdio ? 'env' : 'header'))) throw new McpDraftError(400, 'Credential fields do not match the selected transport.');
      if (args.authentication === 'bearer' && args.secretFields?.length) {
        if (args.secretFields.length !== 1 || args.secretFields[0].location !== 'header' || args.secretFields[0].name.toLowerCase() !== 'authorization') throw new McpDraftError(400, 'Bearer authentication uses one Authorization credential field.');
        args.secretFields[0].prefix = 'Bearer ';
      }
      if (args.authentication === 'header' && !args.secretFields?.length) throw new McpDraftError(400, 'Describe the documented header fields.');
      if (!stdio && (args.authentication === 'bearer' || args.secretFields?.length) && url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new McpDraftError(400, 'Token authentication requires HTTPS or a loopback server.');
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
      if (dryRun) return { dryRun: true, serverId: args.serverId, authentication: args.authentication === 'bearer' ? 'token_required' : 'probe_required' };
      const existing = this.goals.values().find(goal => goal.conversationId === context.conversationId && goal.transcriptId === session.transcriptId
        && JSON.stringify([goal.transport ?? 'streamable-http', goal.execution, goal.secretFields, goal.helpUrl, goal.objective]) === JSON.stringify([args.transport ?? 'streamable-http', args.execution, args.secretFields, args.helpUrl, args.objective])
        && JSON.stringify(goal.sources) === JSON.stringify(selected?.sources)
        && goal.serverId === args.serverId && goal.url === url.href && goal.purpose === args.purpose && goal.displayName === args.displayName && (goal.authentication ?? 'auto') === (args.authentication ?? 'auto') && goal.phase !== 'cancelled' && goal.phase !== 'ready' && goal.expiresAt > Date.now());
      if (existing) return this.view(existing);
      for (const previous of this.goals.values().filter(item => item.conversationId === context.conversationId && (item.phase !== 'ready' || !item.resumed) && item.phase !== 'cancelled')) {
        this.cancelGoal(previous);
      }
      const goal: Goal = { id: randomUUID(), conversationId: context.conversationId, transcriptId: session.transcriptId,
        agentId: context.agentId, serverId: args.serverId, displayName: args.displayName, url: url.href, purpose: args.purpose, authentication: args.authentication,
        transport: args.transport, execution: args.execution, secretFields: args.secretFields, helpUrl: args.helpUrl, objective: args.objective,
        reviewRequired: stdio || Boolean(selected), publicOnly: Boolean(selected && !stdio), sources: selected?.sources,
        expectedRevision: mcpConfigRevision(server), version: 1, phase: channel || stdio || selected ? 'approval_required' : 'planned', ...(channel ? { channel } : {}), expiresAt: Date.now() + 15 * 60_000 };
      this.goals.set(goal.id, goal); this.notify(goal); return this.view(goal);
    }
    if (command === 'remove' || command === 'set_enabled') {
      const args = serverSchema.parse(input);
      if (command === 'set_enabled' && args.enabled === undefined) throw new McpDraftError(400, 'enabled is required.');
      if (dryRun) return { dryRun: true, serverId: args.serverId };
      return this.options.withConfigLock(async () => {
        const config = this.options.readConfig(), server = configuredServer(config, args.serverId);
        if (!server || isManagedConnectorServer(server) || server.xopcPlugin || mcpConfigRevision(server) !== args.expectedRevision) throw new McpDraftError(409, 'The custom server changed or belongs to another owner. Inspect again.');
        for (const goal of this.goals.values().filter(item => item.serverId === args.serverId && item.phase !== 'ready' && item.phase !== 'cancelled')) { this.cancelGoal(goal); }
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
    if (goal.nextRetryAt && Date.now() < goal.nextRetryAt) { this.scheduleRetry(goal); return this.view(goal); }
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
        const fields = goal.secretFields?.length ? goal.secretFields : [{ id: 'token', name: 'Authorization', location: 'header' as const, prefix: 'Bearer ', label: 'Token' }];
        const secretConfig: Record<string, Record<string, unknown>> = {};
        for (const field of fields) {
          const provider = goal.secretProviders?.[field.id] ?? (field.id === 'token' ? goal.tokenProvider : undefined);
          if (provider) (secretConfig[field.location === 'env' ? 'env' : 'headers'] ??= {})[field.name] = { xopcSecretRef: { provider, fieldKey: field.id, prefix: field.prefix } };
        }
        const draft = await this.drafts.create('local-owner', { serverId: goal.serverId,
          ...(published ? { sourceServerId: goal.serverId, expectedServer: published } : {}),
          server: { ...(goal.transport === 'stdio' ? { ...goal.execution, sourceUrl: undefined, type: 'stdio', xopcManagedStdio: true } : { url: goal.url, type: goal.transport ?? 'streamable-http' }),
            displayName: goal.displayName, enabled: true, xopcSetupId: goal.id, xopcPublicOnly: goal.publicOnly, ...secretConfig } });
        this.current(goal); draftId = draft.id; this.draftIds.set(goal.id, draftId);
        if (goal.phase === 'authorizing') { goal.phase = 'planned'; this.save(goal); }
      }
      if ((goal.authentication === 'bearer' && !goal.secretFields?.length && !goal.tokenProvider && !goal.secretProviders?.token)
        || goal.secretFields?.some(field => !goal.secretProviders?.[field.id])) {
        goal.phase = 'token_required'; goal.errorCode = undefined; this.save(goal); return this.view(goal);
      }
      if (goal.phase === 'authorizing') {
        const auth = this.drafts.authorization('local-owner', draftId);
        if (auth.state === 'error' || auth.state === 'cancelled') { goal.phase = 'blocked'; goal.errorCode = 'authorization_failed'; this.save(goal); return this.view(goal); }
        if (auth.state !== 'connected') return this.view(goal);
      } else {
        if ((goal.attempts ?? 0) >= 3) { goal.phase = 'blocked'; goal.nextRetryAt = undefined; goal.diagnosis = { ...goal.diagnosis, recovery: { kind: 'report_blocker', reason: 'retry_budget_exhausted' } }; this.save(goal); return this.view(goal); }
        goal.attempts = (goal.attempts ?? 0) + 1; goal.nextRetryAt = undefined; this.save(goal);
        const probe = await this.drafts.probe('local-owner', draftId, { beforeRequest: request => {
          this.current(goal); const key = `${request?.method ?? 'GET'}:${request?.stage ?? 'metadata'}`;
          goal.requestCounts ??= {};
          if ((goal.requestCounts[key] ?? 0) >= 3) throw new Error('MCP retry budget exhausted for this protocol stage');
          goal.requestCounts[key] = (goal.requestCounts[key] ?? 0) + 1; this.goals.set(goal.id, goal);
        } }); this.current(goal);
        goal.diagnosis = { auth: probe.auth, observation: probe.observation, recovery: probe.recovery };
        if (probe.state !== 'connected') {
          goal.phase = probe.state === 'error' ? 'blocked' : probe.state;
          goal.errorCode = probe.state === 'token_required' && (goal.tokenProvider || goal.secretProviders) ? 'credential_rejected' : probe.errorCode;
          if ((probe.recovery?.kind === 'wait' || ['network', 'timeout', 'connection_refused'].includes(probe.errorCode ?? '')) && (goal.attempts ?? 0) < 3) {
            goal.nextRetryAt = probe.recovery?.retryAt ?? Date.now() + (goal.attempts === 1 ? 2000 : 5000);
          }
          this.save(goal); this.scheduleRetry(goal); return this.view(goal);
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

  private scheduleRetry(goal: Goal) {
    if (this.retryTimers.has(goal.id) || !goal.nextRetryAt || goal.nextRetryAt >= goal.expiresAt || this.disposed) return;
    const version = goal.version;
    const timer = setTimeout(() => { this.retryTimers.delete(goal.id);
      if (this.disposed) return;
      try { const current = this.goals.get(goal.id);
        if (!current || current.version !== version) return;
        void this.advance(current).catch(() => {});
      } catch { /* Disposal may close the database before this queued timer runs. */ }
    }, Math.max(1, goal.nextRetryAt - Date.now()));
    timer.unref(); this.retryTimers.set(goal.id, timer);
  }

  /** Owner-only UI; secret values and OAuth URLs never pass through the model API. */
  async interact(id: string, action: 'get' | 'advance' | 'token' | 'authorize' | 'cancel' | 'approve' | 'retry_delivery', value?: string | Record<string, string>, expectedVersion?: number, ownerPrincipalId = 'local-owner') {
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
      return { ...this.view(goal), endpointOrigin: goal.transport === 'stdio' ? 'Gateway local process' : new URL(goal.url).origin, approval: goal.channel ? { ...goal.channel, endpoint: goal.url, purpose: goal.purpose } : undefined, canReplaceToken: Boolean(goal.tokenProvider || goal.secretProviders), authorizationUrl, authState, requiresRecheck: !draftId && goal.phase !== 'ready' && goal.phase !== 'cancelled' && goal.phase !== 'approval_required' };
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
      if (!(goal.channel || goal.reviewRequired) || goal.phase !== 'approval_required' || !ownerPrincipalId) throw new McpDraftError(409, 'This request cannot be approved.');
      goal.approvedBy = ownerPrincipalId; goal.phase = 'planned'; this.save(goal); return this.advance(goal);
    }
    if (goal.phase === 'approval_required') throw new McpDraftError(409, 'Approve the exact Weixin request before continuing.');
    if (action === 'token') {
      if (!(goal.phase === 'token_required' || goal.phase === 'blocked' && (goal.tokenProvider || goal.secretProviders) || this.canProvideToken(goal))) throw new McpDraftError(400, 'A token is required for this setup.');
      if (goal.nextRetryAt && Date.now() < goal.nextRetryAt) throw new McpDraftError(409, 'The service cooldown has not expired. Wait before submitting credentials.');
      const fields = goal.secretFields?.length ? goal.secretFields : [{ id: 'token', name: 'Authorization', location: 'header' as const, prefix: 'Bearer ', label: 'Token' }];
      const values = typeof value === 'string' && fields.length === 1 ? { [fields[0].id]: value } : value;
      if (!values || typeof values !== 'object' || Object.keys(values).length !== fields.length || fields.some(field => !Object.hasOwn(values, field.id) || typeof values[field.id] !== 'string' || !values[field.id].trim() || values[field.id].length > 16384 || /[\r\n\0]/.test(values[field.id]))) throw new McpDraftError(400, 'Provide every requested secret field without control characters.');
      if (this.busy.has(id)) throw new McpDraftError(409, 'A check is in progress.');
      const url = new URL(goal.url);
      if (goal.transport !== 'stdio' && url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new McpDraftError(400, 'Token authentication requires HTTPS or a loopback server.');
      // Claim this form version before any credential I/O so two submissions cannot overwrite it.
      this.busy.add(id); this.save(goal);
      const providers: Record<string, string> = {};
      const credentials = new CredentialResolver();
      try {
        for (const field of fields) { const provider = connectorSecretProviderId(`mcp-setup-${id}-${goal.version}`, field.id); providers[field.id] = provider; await credentials.saveApiKey(provider, values[field.id].trim()); this.current(goal); }
        const old = this.draftIds.get(id);
        if (old) { try { this.drafts.remove('local-owner', old); } catch (error) { if (!(error instanceof McpDraftError) || error.status !== 404) throw error; } }
        this.draftIds.delete(id); goal.secretProviders = providers; goal.tokenProvider = providers.token; goal.phase = 'planned'; goal.errorCode = undefined; goal.attempts = 0; goal.requestCounts = {}; goal.nextRetryAt = undefined; this.save(goal);
      } catch (error) { await Promise.all(Object.values(providers).map(provider => credentials.deleteProfile(`${provider}:default`))); throw error; }
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
    for (const timer of this.retryTimers.values()) clearTimeout(timer); this.retryTimers.clear();
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
    for (const goal of this.goals.values().filter(item => item.phase === 'blocked' && item.nextRetryAt)) {
      try { this.current(goal); this.scheduleRetry(goal); } catch { /* A revoked objective cannot retry. */ }
    }
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
