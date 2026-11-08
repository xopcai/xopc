import { normalizeClarificationSubmission, type ClarificationResponseCommand } from '@xopcai/gateway-contract';
import { sessionInputCommandSchema, canonicalSessionCommand } from '@xopcai/gateway-contract';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { commandRegistry } from '../../agent/commands/command-registry.js';
import { resumeChildRun } from '../../agent/orchestration/child-run-resume.js';
import { manageTuiCapability, type TuiManagementCommand } from '../tui-management.js';
import { listTuiCapabilities, type TuiCapabilityKind } from '../tui-capabilities.js';
import { getChildRunMessages, steerChildRun, listChildRuns, getChildRun, stopChildRun } from '../../agent/orchestration/child-run-monitor.js';
import type { TuiClarification } from '../tui-clarification.js';
import type { ClarifyRequestPayload, ClarifyRequestResult } from '../../agent/tools/clarify-tool.js';
import { getSessionInteractionPolicy, setSessionInteractionPolicy, type SessionInteractionPolicy } from '../../agent/session/interaction-policy.js';
import { searchTuiHistory, resizeTuiJob, getTuiWorkspaceDiff, listTuiJobs, getTuiJob, stopTuiJob, writeTuiJob } from '../backend-services.js';
import { EmbeddedDraftStore } from './embedded-drafts.js';
import { resolveStateDir } from '../../config/paths.js';
import { resolveEffectiveAgentProfile } from '../../config/agent-profile.js';
import { acceptSessionCommand } from '../../storage/sqlite/session-creation-repository.js';
import { cancelQueuedSessionInput, claimNextSessionInput, finishSessionInputRun, getSessionInputById, getSessionInputState, setSessionInputStatus } from '../../storage/sqlite/session-input-repository.js';
import type { ExtensionRegistryImpl } from '../../extensions/extension-registry-impl.js';
import type { AgentService } from '../../agent/service.js';
import { listAgentEntries, normalizeAgentId } from '../../agent/agent-scope.js';
import { parseModelRef } from '../../agent/models/selection.js';
import { createCreateShareTool, isShareToolAvailable } from '../../agent/tools/create-share-tool.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { buildSessionTimeline, type SessionTimelineItem } from '../../session/transcript-outline.js';
import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { getAgentDefaultModelRef, type Config } from '../../config/schema.js';
import { AgentCatalogService } from '../../agent-catalog/service.js';
import { MessageBus, MessageBusShutdownError } from '../../infra/bus/index.js';
import { evictEmbeddedSessionRunner } from '../../agent/embedded/session-runner.js';
import { buildReviewContext, resolveGitRoot } from '../../review/review-git.js';
import { effectiveWorkspacePathForSession } from '../../session/session-workspace.js';
import { SessionStatus, type ExportFormat } from '../../session/types.js';
import { SessionIndex } from '../../session/index.js';
import {
  appendComposerInputHistory,
  getSessionMetadata,
  getSessionConfig,
  listComposerInputHistory,
  openXopcDatabase,
  isXopcDatabaseOpen,
} from '../../storage/sqlite/index.js';
import { createLogger } from '../../utils/logger.js';
import type {
  ChatSendOptions,
  HistoryMessage,
  TuiBackend,
  TuiCompactionResult,
  TuiComposerHistoryItem,
  TuiEvent,
  TuiModelChoice,
  TuiShareRequest,
  TuiShareResult,
  TuiSessionStats,
  TuiSessionItem,
  TuiTranscriptTreeEntry,
  TuiAgentInfo,
  TuiWorkspaceFileSearchEntry,
  TuiStartupProjectResult,
  TuiChatInputState,
} from '../tui-backend.js';
import type { SessionInfo } from '../tui-types.js';
import { sessionMetadataToTuiItem } from '../tui-session-format.js';
import { computeTuiSessionStats } from '../tui-session-stats.js';
import { buildTuiTranscriptTree, transcriptTreeEntryIdToRowNumber } from '../tui-transcript-tree.js';
import { ChatStreamMapper } from '../../gateway/chat-stream/mapper.js';
import { collectTuiStartupResources } from '../tui-startup-resources.js';
import { fuzzySearchWorkspaceFiles } from '../../gateway/workspace-file-search.js';
import { inferSuggestedProjectDefaultAgentId, ProjectService } from '../../projects/index.js';
import { getXopcCloudCatalogCoordinator } from '../../providers/xopc-cloud-catalog-coordinator.js';
import { commitDeliveredChatInput } from '../tui-chat-input-state.js';

const log = createLogger('TUI:Embedded');

function clampHistoryWindowSpan(value: number | undefined, fallback: number): number {
  const parsed = Math.trunc(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(2000, Math.max(0, parsed));
}

interface EmbeddedBackendOptions {
  config?: Config;
  extensionRegistry?: ExtensionRegistryImpl;
  implicitTrustedWorkspace?: string;
  isWorkspaceTrusted?: (workspaceDir: string) => boolean | null | undefined;
}

function isPathSameOrInside(parentDir: string, childDir: string): boolean {
  const rel = relative(resolve(parentDir), resolve(childDir));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function deliveredUserMessageText(event: { type: string; [key: string]: unknown }): string | undefined {
  if (event.type !== 'message_start' || !event.message || typeof event.message !== 'object') return undefined;
  const message = event.message as { role?: unknown; content?: unknown };
  if (message.role !== 'user') return undefined;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return undefined;
  return message.content
    .map((block) => block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      ? String((block as { text?: unknown }).text ?? '')
      : '')
    .join('');
}

/**
 * TUI backend that runs the agent in-process (no gateway required).
 *
 * Wraps `AgentService` directly and emits TuiEvents by observing the
 * `MessageBus` output stream.
 */
export class EmbeddedBackend implements TuiBackend {
  private bus: MessageBus;
  private agent: AgentService | null = null;
  private agentLoading: Promise<AgentService> | null = null;
  private config: Config | null = null;
  private workspace = '';
  private sessionIndex: SessionIndex | null = null;
  private sessionIndexReady: Promise<void> | null = null;
  private running = false;
  private readonly visitedConversations = new Set<string>();
  private readonly clarificationWaits = new Map<string, {
    request: TuiClarification;
    resolve: (result: ClarifyRequestResult) => void;
    reject: (error: Error) => void;
    dispose: () => void;
  }>();
  private chatAbort: AbortController | null = null;
  private readonly chatInputStates = new Map<string, TuiChatInputState>();
  private readonly drafts = new EmbeddedDraftStore();
  private readonly inputStateRevisions = new Map<string, number>();

  onEvent?: (evt: TuiEvent) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;

  constructor(private readonly opts?: EmbeddedBackendOptions) {
    this.bus = new MessageBus();
  }

  get connectionLabel(): string {
    return 'local embedded';
  }

  async getComposerInputHistory(conversationId: string): Promise<TuiComposerHistoryItem[]> {
    return listComposerInputHistory(conversationId);
  }
  async getComposerDraftDirectory(): Promise<string> {
    return join(resolveStateDir(), 'client-drafts', 'embedded', 'composers');
  }

  async recordComposerInputHistory(conversationId: string, text: string): Promise<TuiComposerHistoryItem> {
    return appendComposerInputHistory(conversationId, text).item;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const config = this.opts?.config ?? loadConfig();
    this.config = config;
    const workspace = getWorkspacePath(config);
    this.workspace = workspace;
    openXopcDatabase();
    this.sessionIndex = new SessionIndex({ config });
    this.sessionIndexReady = this.sessionIndex.initialize().catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage }, `Embedded session index initialization failed: ${errorMessage}`);
      throw err;
    });

    this.onConnected?.();
    setTimeout(() => {
      void this.ensureAgent().catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.error({ err, errorMessage }, `Embedded agent failed: ${errorMessage}`);
        this.onDisconnected?.(errorMessage);
      });
    }, 750);

    // Process outbound messages in background
    this.processOutbound();
  }

  private async ensureAgent(): Promise<AgentService> {
    if (this.agent) {
      return this.agent;
    }
    if (this.agentLoading) {
      return this.agentLoading;
    }
    if (!this.config || !this.sessionIndex) {
      if (!this.running) {
        this.start();
      }
    }
    if (!this.config || !this.sessionIndex) {
      throw new Error('Embedded backend not started');
    }

    this.agentLoading = this.createAgent(this.config, this.sessionIndex);
    try {
      return await this.agentLoading;
    } finally {
      this.agentLoading = null;
    }
  }

  private async createAgent(config: Config, sessionIndex: SessionIndex): Promise<AgentService> {
    await this.refreshXopcCloudModels();
    const { AgentService } = await import('../../agent/service.js');
    const workspace = this.workspace || getWorkspacePath(config);
    const modelId = getAgentDefaultModelRef();
    const agent = new AgentService(this.bus, {
      workspace,
      model: modelId,
      config,
      sessionStore: sessionIndex.getStore(),
      extensionRegistry: this.opts?.extensionRegistry,
      gatewayClarify: { requestClarification: (context, request) => this.askClarification(context.conversationId, context.runId, request) },
      isWorkspaceTrusted: (workspaceDir) => this.isWorkspaceTrusted(workspaceDir),
    });
    this.agent = agent;
    await agent.start();
    return agent;
  }

  private async refreshXopcCloudModels(): Promise<void> {
    try {
      const readiness = await getXopcCloudCatalogCoordinator().ensure({
        reason: 'agent-run',
        network: 'if-empty',
        timeoutMs: 10_000,
      });
      if (!readiness.error) return;
      log.warn(
        { errorMessage: readiness.error.message, phase: 'model_catalog_refresh' },
        `XOPC Cloud model catalog refresh failed: ${readiness.error.message}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn(
        { err, errorMessage, phase: 'model_catalog_refresh' },
        `XOPC Cloud model catalog refresh failed: ${errorMessage}`,
      );
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const wait of this.clarificationWaits.values()) { wait.dispose(); wait.reject(new Error('TUI stopped')); }
    this.clarificationWaits.clear();
    this.chatAbort?.abort();
    this.chatAbort = null;
    this.bus.shutdown();
    const jobs: Array<Promise<unknown>> = [];
    for (const conversationId of this.visitedConversations) {
      for (const child of listChildRuns(conversationId)) if (child.status === 'running') stopChildRun(conversationId, child.id);
      for (const job of isXopcDatabaseOpen() ? commandRegistry().list(conversationId) : []) if (job.status === 'running') jobs.push(commandRegistry().cancel(conversationId, job.id));
    }
    await Promise.allSettled(jobs);
    await this.agent?.stop();
    this.agent = null;
  }

  getActiveSignal(): AbortSignal | undefined {
    const signal = this.chatAbort?.signal;
    return signal && !signal.aborted ? signal : undefined;
  }

  private activeConfig(): Config {
    return this.config ?? this.opts?.config ?? loadConfig();
  }

  private isWorkspaceTrusted(workspaceDir: string): boolean {
    const explicit = this.opts?.isWorkspaceTrusted?.(workspaceDir);
    if (explicit !== undefined && explicit !== null) {
      return explicit;
    }
    const implicit = this.opts?.implicitTrustedWorkspace;
    return Boolean(implicit && isPathSameOrInside(implicit, workspaceDir));
  }

  async getStartupResources(conversationId: string) {
    const draft = this.drafts.read(conversationId);
    return collectTuiStartupResources(this.activeConfig(), draft ? undefined : conversationId, {
      agentId: draft?.creation.agentId,
      isWorkspaceTrusted: (workspaceDir) => this.isWorkspaceTrusted(workspaceDir),
    });
  }

  refreshWorkspaceTrust(): void {
    this.agent?.refreshSkillsAfterTrustChange();
  }

  async resolveStartupProject(opts: {
    workspacePath: string;
    conversationId: string;
    agentId: string;
    autoCreate?: boolean;
  }): Promise<TuiStartupProjectResult> {
    await this.sessionIndexReady;
    if (!this.sessionIndex) return { project: null };
    const projects = new ProjectService();
    const defaultAgentId = inferSuggestedProjectDefaultAgentId({
      config: this.activeConfig(),
      workspaceRoot: opts.workspacePath,
    });
    const match = projects.resolveOrCreateForWorkspacePath({
      workspacePath: opts.workspacePath,
      agentId: opts.agentId,
      defaultAgentId,
      autoCreate: opts.autoCreate !== false,
    });
    if (!match) return { project: null };
    const projectAgentId = match.project.defaultAgentId?.trim()
      ? normalizeAgentId(match.project.defaultAgentId)
      : undefined;
    if (projectAgentId && projectAgentId !== normalizeAgentId(opts.agentId)) {
      return { project: match.project, created: match.created, reason: match.reason };
    }
    const draft = this.drafts.read(opts.conversationId);
    if (draft) {
      if (draft.command || draft.materialization) throw new Error('First input is awaiting confirmation');
      draft.creation.projectId = match.project.id;
      this.drafts.save(opts.conversationId, draft);
      return { project: match.project, created: match.created, reason: match.reason };
    }
    if (!getSessionMetadata(opts.conversationId)) {
      await this.sessionIndex.getStore().resolveTranscriptPath(opts.conversationId, {
        metadata: {
          sourceChannel: 'tui',
          sourceChatId: `default:direct:${opts.conversationId}`,
          sessionType: 'chat',
          projectId: match.project.id,
          routing: {
            agentId: opts.agentId,
            source: 'tui',
            accountId: 'default',
            peerKind: 'direct',
            peerId: opts.conversationId,
          },
        },
      });
    }
    projects.attachSession(opts.conversationId, match.project.id);
    return { project: match.project, created: match.created, reason: match.reason };
  }

  async searchWorkspaceFiles(
    conversationId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<TuiWorkspaceFileSearchEntry[]> {
    const draft = this.drafts.read(conversationId);
    if (!this.agent && !draft) return [];
    try {
      const workspaceRoot = draft ? (await this.getSessionInfo(conversationId)).effectiveWorkspacePath!
        : await this.agent!.getEffectiveWorkspacePathForSession(conversationId);
      return await fuzzySearchWorkspaceFiles(workspaceRoot, query, options?.limit ?? 15);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded workspace file search failed: ${errorMessage}`);
      return [];
    }
  }

  async getReviewContext(conversationId: string) {
    if (this.drafts.read(conversationId)) {
      const info = await this.getSessionInfo(conversationId);
      return buildReviewContext(await resolveGitRoot(info.effectiveWorkspacePath!));
    }
    const config = this.activeConfig();
    const metadata = getSessionMetadata(conversationId);
    const project = metadata?.projectId ? new ProjectService().get(metadata.projectId) : null;
    const workspace = effectiveWorkspacePathForSession(config, conversationId, null, project);
    const cwd = await resolveGitRoot(workspace);
    return buildReviewContext(cwd);
  }

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    if (this.drafts.read(opts.conversationId)?.materialization) await this.materializeDraft(opts.conversationId);
    const runId = crypto.randomUUID();
    let durableInput = false;
    const draft = this.drafts.read(opts.conversationId);
    if (draft) {
      const candidate = sessionInputCommandSchema.parse({ kind: 'start',
        clientMessageId: draft.command?.clientMessageId ?? crypto.randomUUID(),
        creation: { ...draft.creation, thinkingLevel: opts.thinking ?? draft.creation.thinkingLevel },
        input: { content: opts.message, ...(opts.attachments?.length ? { attachments: opts.attachments } : {}) },
        origin: { type: 'system', source: 'cli' },
      });
      if (candidate.kind !== 'start') throw new Error('Expected first input');
      if (draft.command && canonicalSessionCommand(draft.command) !== canonicalSessionCommand(candidate)) {
        throw new Error('First input is awaiting confirmation');
      }
      draft.command = candidate;
      draft.creation = candidate.creation;
      this.drafts.save(opts.conversationId, draft);
      await this.ensureAgent();
      const receipt = acceptSessionCommand({ conversationId: opts.conversationId, principalId: 'local:tui',
        command: candidate, sourceChannel: 'tui', config: { ...draft.config,
          modelOverride: draft.creation.model, fixedModel: true,
          thinkingLevel: draft.creation.thinkingLevel as typeof draft.config.thinkingLevel },
        attachProject: (id, projectId) => { new ProjectService().attachSession(id, projectId); },
        preparedInput: { content: opts.message, attachments: opts.attachments, thinking: opts.thinking,
          requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: candidate.origin },
      });
      const accepted = getSessionInputById(opts.conversationId, receipt.inputId!);
      if (accepted?.runId && !['running', 'interrupted', 'queued'].includes(accepted.status)) {
        this.drafts.remove(opts.conversationId);
        return { runId: accepted.runId };
      }
      if (accepted?.status === 'running') {
        let alive = true;
        if (draft.ownerPid) {
          try { process.kill(draft.ownerPid, 0); }
          catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
        }
        if (alive) throw new Error('First input is still owned by a running process');
        finishSessionInputRun(opts.conversationId, accepted.runId!, 'interrupted', 'Embedded process exited');
        throw new Error('Previous run was interrupted. Review its history before explicitly retrying the same input.');
      }
      if (accepted?.status === 'interrupted') setSessionInputStatus(accepted.id, 'queued');
      draft.ownerPid = process.pid;
      this.drafts.save(opts.conversationId, draft);
      const claimed = claimNextSessionInput(opts.conversationId, runId, receipt.inputId!);
      if (!claimed || claimed.id !== receipt.inputId) throw new Error('First input is already queued for execution');
      durableInput = true;
    }
    const agent = await this.ensureAgent();
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    const signal = this.chatAbort.signal;

    const mapper = new ChatStreamMapper({ runId, conversationId: opts.conversationId, channel: 'tui' });
    for (const event of mapper.start()) {
      this.onEvent?.({ event: event.type, data: event, source: 'embedded' });
    }

    // Run the stream in background so the TUI event loop stays responsive.
    void (async () => {
      let initialUserMessageObserved = false;
      let outcome: 'completed' | 'failed' = 'completed';
      try {
        // Prepend envelope timestamp so the model knows the current date/time,
        // matching the behavior of channel pipelines (Telegram, Weixin, etc.).
        // Skip for slash commands — parseSlashCommand requires lines starting with '/'.
        const messageForAgent = opts.message.trimStart().startsWith('/')
          ? opts.message
          : prependEnvelopeTimestamp(opts.message);

        const stream = agent.turnDispatcher.processDirectStreaming(
          messageForAgent,
          opts.conversationId,
          { type: 'system', source: 'cli' },
          opts.attachments,
          opts.thinking,
          { signal, runId },
        );

        for await (const event of stream) {
          if (signal.aborted) break;
          const deliveredInput = deliveredUserMessageText(event);
          if (deliveredInput !== undefined) {
            if (initialUserMessageObserved) {
              this.consumePendingChatInput(opts.conversationId, deliveredInput);
            } else {
              initialUserMessageObserved = true;
            }
          }
          for (const mapped of mapper.map(event)) {
            this.onEvent?.({ event: mapped.type, data: mapped, source: 'embedded' });
          }
        }

        if (!signal.aborted) {
          for (const mapped of mapper.end('success')) {
            this.onEvent?.({ event: mapped.type, data: mapped, source: 'embedded' });
          }
        }
      } catch (error) {
        outcome = 'failed';
        if (signal.aborted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        for (const mapped of mapper.error(errorMessage)) {
          this.onEvent?.({ event: mapped.type, data: mapped, source: 'embedded' });
        }
        for (const mapped of mapper.end('error', errorMessage)) {
          this.onEvent?.({ event: mapped.type, data: mapped, source: 'embedded' });
        }
      } finally {
        if (durableInput) {
          finishSessionInputRun(opts.conversationId, runId, signal.aborted ? 'cancelled' : outcome);
          try { this.drafts.remove(opts.conversationId); }
          catch (err) { log.warn({ err, conversationId: opts.conversationId }, 'Accepted draft cleanup failed'); }
          this.publishChatInputState(this.chatInputStates.get(opts.conversationId)
            ?? { conversationId: opts.conversationId, revision: 0, inputs: [] });
        }
      }
    })();

    return { runId };
  }

  async abortChat(_opts: { conversationId: string; runId: string }): Promise<{ ok: boolean }> {
    if (this.chatAbort) {
      this.chatAbort.abort();
      this.chatAbort = null;
      return { ok: true };
    }
    return { ok: false };
  }

  async submitChatInput(opts: { conversationId: string; message: string; delivery: 'next' | 'steer' }): Promise<{
    ok: boolean;
    effectiveDelivery?: 'next' | 'steer';
    state?: TuiChatInputState;
  }> {
    if (!this.agent) return { ok: false };
    if (opts.delivery === 'steer') {
      const ok = await this.agent.turnDispatcher.steerWebchatSession(opts.conversationId, opts.message);
      if (!ok) return { ok: false };
      const state = this.appendPendingChatInput(opts.conversationId, opts.message, 'steer');
      return { ok: true, effectiveDelivery: 'steer', state };
    }
    const { getEmbeddedRunByConversationId } = await import('../../agent/embedded/runs.js');
    const handle = getEmbeddedRunByConversationId(opts.conversationId);
    if (!handle) return { ok: false };
    await handle.session.followUp(opts.message);
    const state = this.appendPendingChatInput(opts.conversationId, opts.message, 'next');
    return { ok: true, effectiveDelivery: 'next', state };
  }

  async getChatInputState(conversationId: string): Promise<TuiChatInputState> {
    const draft = this.drafts.read(conversationId);
    if (draft?.command) {
      const durable = getSessionInputState(conversationId);
      const input = durable.inputs.find(item => item.clientMessageId === draft.command!.clientMessageId);
      if (input?.status === 'running' && draft.ownerPid) {
        let alive = true;
        try { process.kill(draft.ownerPid, 0); }
        catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
        if (!alive) {
          finishSessionInputRun(conversationId, input.runId!, 'interrupted', 'Embedded process exited');
          return this.sequenceInputState(getSessionInputState(conversationId));
        }
      }
      if (durable.inputs.length) {
        const local = this.chatInputStates.get(conversationId);
        return this.sequenceInputState({ ...durable,
          inputs: [...durable.inputs, ...(local?.inputs.filter(item => !durable.inputs.some(saved => saved.id === item.id)) ?? [])] });
      }
    }
    return this.sequenceInputState(this.chatInputStates.get(conversationId) ?? { conversationId, revision: 0, inputs: [] });
  }

  async updateChatInput(opts: {
    conversationId: string;
    inputId: string;
    version: number;
    content: string;
  }): Promise<{ ok: boolean; state?: TuiChatInputState }> {
    const current = await this.getChatInputState(opts.conversationId);
    const target = current.inputs.find((input) => input.id === opts.inputId);
    if (!target || target.version !== opts.version || target.status !== 'queued') return { ok: false, state: current };
    const state: TuiChatInputState = {
      ...current,
      revision: current.revision + 1,
      inputs: current.inputs.map((input) => input.id === target.id
        ? { ...input, content: opts.content, version: input.version + 1 }
        : input),
    };
    if (!await this.replaceEmbeddedQueue(opts.conversationId, state)) return { ok: false, state: current };
    this.publishChatInputState(state);
    return { ok: true, state };
  }

  async removeChatInput(opts: {
    conversationId: string;
    inputId: string;
    version: number;
  }): Promise<{ ok: boolean; state?: TuiChatInputState }> {
    if (this.drafts.read(opts.conversationId)?.command && getSessionInputById(opts.conversationId, opts.inputId)) {
      const ok = cancelQueuedSessionInput(opts.conversationId, opts.inputId, opts.version);
      if (ok) this.drafts.remove(opts.conversationId);
      return { ok, state: this.sequenceInputState(getSessionInputState(opts.conversationId)) };
    }
    const current = await this.getChatInputState(opts.conversationId);
    const target = current.inputs.find((input) => input.id === opts.inputId);
    if (!target || target.version !== opts.version || (target.status !== 'queued' && target.status !== 'interrupted')) {
      return { ok: false, state: current };
    }
    const state: TuiChatInputState = {
      ...current,
      revision: current.revision + 1,
      inputs: current.inputs.filter((input) => input.id !== target.id),
    };
    if (!await this.replaceEmbeddedQueue(opts.conversationId, state)) return { ok: false, state: current };
    this.publishChatInputState(state);
    return { ok: true, state };
  }

  private appendPendingChatInput(conversationId: string, content: string, delivery: 'next' | 'steer'): TuiChatInputState {
    const current = this.chatInputStates.get(conversationId) ?? { conversationId, revision: 0, inputs: [] };
    const state: TuiChatInputState = {
      ...current,
      revision: current.revision + 1,
      inputs: [...current.inputs, {
        id: crypto.randomUUID(),
        content,
        requestedDelivery: delivery,
        effectiveDelivery: delivery,
        status: delivery === 'steer' ? 'injecting' : 'queued',
        version: 1,
        position: current.inputs.length,
      }],
    };
    this.publishChatInputState(state);
    return state;
  }

  private consumePendingChatInput(conversationId: string, content: string): void {
    const current = this.chatInputStates.get(conversationId);
    if (!current?.inputs.length) return;
    const next = commitDeliveredChatInput(current, content);
    if (next !== current) this.publishChatInputState(next);
  }

  private publishChatInputState(state: TuiChatInputState): void {
    state = this.sequenceInputState(state);
    this.chatInputStates.set(state.conversationId, { ...state, inputs: state.inputs.filter(input => input.status !== 'running') });
    this.onEvent?.({ event: 'session.input-state', data: state, source: 'embedded' });
  }

  private sequenceInputState(state: TuiChatInputState): TuiChatInputState {
    const revision = Math.max(state.revision, (this.inputStateRevisions.get(state.conversationId) ?? -1) + 1);
    this.inputStateRevisions.set(state.conversationId, revision);
    return { ...state, revision };
  }

  private async replaceEmbeddedQueue(conversationId: string, state: TuiChatInputState): Promise<boolean> {
    const { getEmbeddedRunByConversationId } = await import('../../agent/embedded/runs.js');
    const handle = getEmbeddedRunByConversationId(conversationId);
    if (!handle) return false;
    handle.session.clearQueue();
    for (const input of state.inputs) {
      if (input.status === 'injecting') await handle.session.steer(input.content);
      else if (input.status === 'queued') await handle.session.followUp(input.content);
    }
    return true;
  }

  async loadHistory(opts: {
    conversationId: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }> {
    const draft = this.drafts.read(opts.conversationId);
    if (draft && (!draft.command || !getSessionMetadata(opts.conversationId))) return { messages: [] };
    await this.sessionIndexReady;
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) throw new Error('Session store is unavailable.');
    try {
      const rows = await store.loadTranscriptRows(opts.conversationId);
      return {
        messages: transcriptRowsToClientHistory(rows, { limit: opts.limit }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Embedded loadHistory failed: ${errorMessage}`);
      throw error;
    }
  }

  async loadHistoryWindow(opts: {
    conversationId: string;
    rowNumber: number;
    before?: number;
    after?: number;
  }) {
    await this.sessionIndexReady;
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) throw new Error('Session store is unavailable.');
    try {
      const rows = await store.loadTranscriptHistoryRows(opts.conversationId);
      const totalRows = rows.length;
      if (totalRows === 0) {
        return { messages: [], startRowNumber: 0, endRowNumber: 0, totalRows };
      }
      const targetRowNumber = Math.min(totalRows, Math.max(1, Math.trunc(opts.rowNumber)));
      const before = clampHistoryWindowSpan(opts.before, 80);
      const after = clampHistoryWindowSpan(opts.after, 120);
      const startRowNumber = Math.max(1, targetRowNumber - before);
      const endRowNumber = Math.min(totalRows, targetRowNumber + after);
      return {
        messages: transcriptRowsToClientHistory(rows, { startRowNumber, endRowNumber }),
        startRowNumber,
        endRowNumber,
        totalRows,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn(
        { err: error, conversationId: opts.conversationId, rowNumber: opts.rowNumber, errorMessage },
        `Embedded loadHistoryWindow failed: ${errorMessage}`,
      );
      throw error;
    }
  }

  async loadTranscriptTree(conversationId: string): Promise<TuiTranscriptTreeEntry[]> {
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) throw new Error('Session store is not ready.');
    try {
      const rows = await store.loadTranscriptRows(conversationId);
      return buildTuiTranscriptTree(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded loadTranscriptTree failed: ${errorMessage}`);
      throw error;
    }
  }

  async loadTimeline(conversationId: string): Promise<SessionTimelineItem[]> {
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) throw new Error('Session store is not ready.');
    try {
      const rows = await store.loadTranscriptRows(conversationId);
      return buildSessionTimeline(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded loadTimeline failed: ${errorMessage}`);
      throw error;
    }
  }

  async getSessionStats(conversationId: string): Promise<TuiSessionStats> {
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) return computeTuiSessionStats([]);
    try {
      const rows = await store.loadTranscriptRows(conversationId);
      return computeTuiSessionStats(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded getSessionStats failed: ${errorMessage}`);
      return computeTuiSessionStats([]);
    }
  }

  private askClarification(conversationId: string, runId: string, request: ClarifyRequestPayload): Promise<ClarifyRequestResult> {
    const id = crypto.randomUUID();
    const signal = this.chatAbort?.signal;
    const expiresAt = request.kind === 'approval' ? Date.now() + 10 * 60_000 : undefined;
    const presentation: TuiClarification = { ...request, id, conversationId, version: 1, kind: request.kind ?? 'input', expiresAt };
    return new Promise((resolveAnswer, reject) => {
      const cancel = () => { this.clarificationWaits.delete(id); clearTimeout(timer); reject(new Error('Clarification cancelled')); };
      const timer = expiresAt ? setTimeout(cancel, Math.max(0, expiresAt - Date.now())) : undefined;
      const dispose = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      signal?.addEventListener('abort', cancel, { once: true });
      this.clarificationWaits.set(id, { request: presentation, resolve: resolveAnswer, reject, dispose });
      if (signal?.aborted) { cancel(); return; }
      this.onEvent?.({ event: 'clarify_request', data: { runId, conversationId, payload: { ...presentation, requestId: id } }, source: 'embedded' });
    });
  }
  async getClarification(conversationId: string): Promise<TuiClarification | null> {
    return [...this.clarificationWaits.values()].find(wait => wait.request.conversationId === conversationId)?.request ?? null;
  }
  async submitClarification(conversationId: string, id: string, command: ClarificationResponseCommand): Promise<void> {
    const wait = this.clarificationWaits.get(id);
    if (!wait || wait.request.conversationId !== conversationId || wait.request.version !== command.expectedVersion) throw new Error('This question is no longer active.');
    if (wait.request.expiresAt && wait.request.expiresAt <= Date.now()) throw new Error('This approval has expired.');
    const answer = command.action === 'answer' ? normalizeClarificationSubmission(wait.request, {
      ...(command.schemaVersion ? { schemaVersion: command.schemaVersion } : {}),
      ...(command.answers ? { answers: command.answers } : {}),
      ...(command.response ? { response: command.response } : {}),
      ...(command.decision ? { decision: command.decision } : {}),
    }).answer : undefined;
    this.clarificationWaits.delete(id);
    wait.dispose();
    if (answer === undefined) wait.reject(new Error('Clarification cancelled by the user.'));
    else wait.resolve({ status: 'answered', answer });
  }

  async manageCapability(conversationId: string, command: TuiManagementCommand) {
    const info = await this.getSessionInfo(conversationId);
    if (!info.effectiveWorkspacePath) throw new Error('Workspace is unavailable');
    return manageTuiCapability({ command, conversationId, config: this.activeConfig(), workspace: info.effectiveWorkspacePath, owner: 'gateway-owner' });
  }
  async listCapabilities(conversationId: string, kind: TuiCapabilityKind) {
    const info = await this.getSessionInfo(conversationId);
    if (!info.effectiveWorkspacePath) throw new Error('Workspace is unavailable.');
    return listTuiCapabilities({ config: this.activeConfig(), workspace: info.effectiveWorkspacePath,
      agentId: info.agentId, kind, trusted: this.isWorkspaceTrusted(info.effectiveWorkspacePath) });
  }

  async listSubagents(conversationId: string) { return listChildRuns(conversationId); }
  async getSubagent(conversationId: string, id: string) { return getChildRun(conversationId, id); }
  async steerSubagent(conversationId: string, id: string, text: string) { await steerChildRun(conversationId, id, text); }
  async resumeSubagent(conversationId: string, id: string, text: string) { await resumeChildRun(conversationId, id, text, this.activeConfig()); }
  async getSubagentTranscript(conversationId: string, id: string) { return JSON.stringify(getChildRunMessages(conversationId, id), null, 2); }
  async stopSubagent(conversationId: string, id: string) { stopChildRun(conversationId, id); }

  async getInteractionPolicy(conversationId: string) { return getSessionInteractionPolicy(conversationId); }
  async setInteractionPolicy(conversationId: string, policy: SessionInteractionPolicy) {
    return setSessionInteractionPolicy(conversationId, policy);
  }
  async getWorkspaceDiff(conversationId: string) {
    const info = await this.getSessionInfo(conversationId);
    if (!info.effectiveWorkspacePath) throw new Error('Workspace is unavailable.');
    return getTuiWorkspaceDiff(info.effectiveWorkspacePath);
  }
  async searchHistory(conversationId: string, query: string) { return searchTuiHistory(conversationId, query); }
  async listJobs(conversationId: string) { return listTuiJobs(conversationId); }
  async getJob(conversationId: string, id: string) { return getTuiJob(conversationId, id); }
  async resizeJob(conversationId: string, id: string, cols: number, rows: number) { resizeTuiJob(conversationId, id, cols, rows); }
  async stopJob(conversationId: string, id: string) { await stopTuiJob(conversationId, id); }
  async writeJob(conversationId: string, id: string, text: string) { writeTuiJob(conversationId, id, text); }

  async listSessions(options?: { archived?: boolean }): Promise<TuiSessionItem[]> {
    await this.sessionIndexReady;
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) throw new Error('Session store is unavailable.');
    try {
      const result = await store.list({
        status: options?.archived ? [SessionStatus.ARCHIVED] : [SessionStatus.ACTIVE, SessionStatus.PINNED],
        limit: 200,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      return result.items.map(sessionMetadataToTuiItem);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Embedded listSessions failed: ${errorMessage}`);
      throw error;
    }
  }

  async listAgents(): Promise<TuiAgentInfo[]> {
    const agents = new Map<string, TuiAgentInfo>();
    for (const entry of listAgentEntries()) {
      if (entry.enabled === false) continue;
      const id = normalizeAgentId(entry.id);
      agents.set(id, {
        id,
        enabled: true,
      });
    }
    return [...agents.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async setTuiDefaultAgent(agentId: string): Promise<{ agentId: string }> {
    new AgentCatalogService().setSurfaceDefault('tui', agentId);
    return { agentId: agentId.trim().toLowerCase() };
  }

  async renameSession(conversationId: string, name: string): Promise<{ ok: boolean }> {
    await this.sessionIndexReady;
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) return { ok: false };
    try {
      await store.updateMetadata(conversationId, { name: name.trim() });
      return { ok: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded renameSession failed: ${errorMessage}`);
      return { ok: false };
    }
  }

  async restoreSession(conversationId: string) { await this.sessionIndexReady; const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore(); if (!store) throw new Error('Session store is unavailable'); await store.unarchive(conversationId); }
  async archiveSession(conversationId: string): Promise<void> {
    await this.sessionIndexReady;
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store || !getSessionMetadata(conversationId)) throw new Error('Only saved conversations can be archived.');
    await store.archive(conversationId);
  }

  async deleteSession(conversationId: string): Promise<{ ok: boolean }> {
    const draft = this.drafts.read(conversationId);
    if (draft && !draft.command && !draft.materialization) { this.drafts.remove(conversationId); return { ok: true }; }
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) return { ok: false };
    try {
      const ok = await store.deleteSession(conversationId);
      if (ok && draft) this.drafts.remove(conversationId);
      return { ok };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded deleteSession failed: ${errorMessage}`);
      return { ok: false };
    }
  }

  async createConversation(agentId: string, conversationId?: string): Promise<string> {
    const id = conversationId ?? crypto.randomUUID();
    if (this.drafts.read(id)) return id;
    const profile = resolveEffectiveAgentProfile(agentId);
    this.drafts.save(id, { creation: { agentId: profile.agentId, projectId: null, execution: null,
      temporary: false, model: profile.primaryModelRef, thinkingLevel: 'off' }, config: {} });
    return id;
  }

  private async materializeDraft(conversationId: string): Promise<void> {
    const draft = this.drafts.read(conversationId);
    if (!draft) return;
    if (draft.command) throw new Error('First input is awaiting confirmation');
    draft.materialization ??= { commandId: crypto.randomUUID(), purpose: 'session_resources', creation: draft.creation };
    this.drafts.save(conversationId, draft);
    await this.ensureAgent();
    acceptSessionCommand({ conversationId, principalId: 'local:tui', sourceChannel: 'tui', command: draft.materialization,
      config: { ...draft.config, modelOverride: draft.creation.model, fixedModel: true,
        thinkingLevel: draft.creation.thinkingLevel as typeof draft.config.thinkingLevel },
      attachProject: (id, projectId) => { new ProjectService().attachSession(id, projectId); } });
    this.drafts.remove(conversationId);
  }

  async getSessionInfo(conversationId: string): Promise<SessionInfo> {
    this.visitedConversations.add(conversationId);
    const draft = this.drafts.read(conversationId);
    if (draft) {
      const model = parseModelRef(draft.creation.model);
      const profile = resolveEffectiveAgentProfile(draft.creation.agentId);
      const project = draft.creation.projectId ? new ProjectService().get(draft.creation.projectId) : null;
      return { agentId: draft.creation.agentId, model: model?.model ?? draft.creation.model,
        modelProvider: model?.provider, thinkingLevel: draft.creation.thinkingLevel,
        reasoningLevel: draft.config.reasoningLevel, verboseLevel: draft.config.verboseLevel,
        projectId: draft.creation.projectId ?? undefined, workingDirectoryLocked: Boolean(project),
        effectiveWorkspacePath: project?.workspaceRoot || draft.config.workingDirectoryOverride || profile.resolvedWorkspacePath };
    }
    if (!this.agent) {
      await this.sessionIndexReady;
      const metadata = getSessionMetadata(conversationId);
      if (!metadata) throw new Error('Session not found.');
      const profile = resolveEffectiveAgentProfile(metadata.agentId);
      const cfg = getSessionConfig(conversationId);
      const project = metadata.projectId ? new ProjectService().get(metadata.projectId) : null;
      const parsed = parseModelRef(cfg?.modelOverride ?? profile.primaryModelRef);
      return { agentId: metadata.agentId, displayName: metadata.name, model: parsed?.model,
        modelProvider: parsed?.provider, thinkingLevel: cfg?.thinkingLevel, reasoningLevel: cfg?.reasoningLevel,
        verboseLevel: cfg?.verboseLevel, projectId: metadata.projectId,
        effectiveWorkspacePath: effectiveWorkspacePathForSession(this.activeConfig(), conversationId, cfg, project),
        workingDirectoryLocked: Boolean(project), interactionPolicy: getSessionInteractionPolicy(conversationId) };
    }
    try {
      const cfg = await this.agent.sessionInspector.agentConfig(conversationId);
      const parsed = parseModelRef(cfg.model);
      const usage = await this.agent.sessionInspector.contextUsage(conversationId);
      return {
        agentId: getSessionMetadata(conversationId)?.agentId,
        model: parsed?.model ?? cfg.model,
        modelProvider: parsed?.provider,
        thinkingLevel: cfg.thinkingLevel,
        reasoningLevel: cfg.activityDetail.effective,
        verboseLevel: cfg.verboseLevel,
        totalTokens: usage.estimatedTokens,
        contextWindow: usage.contextWindow,
        contextUsagePercent: usage.usagePercent,
        effectiveWorkspacePath: cfg.effectiveWorkspacePath,
        workingDirectoryLocked: cfg.workingDirectoryLocked,
        projectId: getSessionMetadata(conversationId)?.projectId,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err, conversationId, errorMessage }, `getSessionInfo failed: ${errorMessage}`);
      throw err;
    }
  }

  async listModels(): Promise<TuiModelChoice[]> {
    const { getAvailableModels } = await import('../../providers/index.js');
    const models = await getAvailableModels();
    return models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      provider: model.provider,
      contextWindow: model.contextWindow,
    }));
  }

  async refreshModels(): Promise<void> {
    await this.refreshXopcCloudModels();
  }

  async resetSession(conversationId: string): Promise<void> {
    if (!this.agent) return;
    await this.agent.resetSession(conversationId);
  }

  async patchSession(
    conversationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const draft = this.drafts.read(conversationId);
    if (draft) {
      if (draft.command || draft.materialization) throw new Error('First input is awaiting confirmation');
      if (typeof patch.model === 'string') draft.creation.model = patch.model;
      if (typeof patch.thinkingLevel === 'string') draft.creation.thinkingLevel = patch.thinkingLevel;
      if (typeof patch.workingDirectory === 'string') draft.config.workingDirectoryOverride = resolve(patch.workingDirectory);
      if (patch.activityDetailLevel === 'off' || patch.activityDetailLevel === 'on' || patch.activityDetailLevel === 'stream') draft.config.reasoningLevel = patch.activityDetailLevel;
      if (patch.verboseLevel === 'off' || patch.verboseLevel === 'on' || patch.verboseLevel === 'full') draft.config.verboseLevel = patch.verboseLevel;
      if (patch.projectId === null || typeof patch.projectId === 'string') draft.creation.projectId = typeof patch.projectId === 'string' ? patch.projectId : null;
      this.drafts.save(conversationId, draft);
      return;
    }
    const agent = await this.ensureAgent();
    const hasProjectPatch = Object.prototype.hasOwnProperty.call(patch, 'projectId');
    const projectId = typeof patch.projectId === 'string' ? patch.projectId.trim() : '';
    const result = await agent.sessionConfig.patch(conversationId, {
      model: typeof patch.model === 'string' ? patch.model : undefined,
      thinkingLevel: typeof patch.thinkingLevel === 'string' ? patch.thinkingLevel : undefined,
      activityDetailLevel: typeof patch.activityDetailLevel === 'string' ? patch.activityDetailLevel : undefined,
      verboseLevel: typeof patch.verboseLevel === 'string' ? patch.verboseLevel : undefined,
      workingDirectory: typeof patch.workingDirectory === 'string' ? patch.workingDirectory : undefined,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    if (projectId) {
      await this.sessionIndexReady;
      await this.sessionIndex?.getStore().resolveTranscriptPath(conversationId);
      new ProjectService().attachSession(conversationId, projectId);
    } else if (hasProjectPatch && patch.projectId === null) {
      new ProjectService().detachSession(conversationId);
    }
    const hiddenFromSessionList = typeof patch.hiddenFromSessionList === 'boolean'
      ? patch.hiddenFromSessionList
      : undefined;
    const customData = patch.customData && typeof patch.customData === 'object' && !Array.isArray(patch.customData)
      ? patch.customData as Record<string, unknown>
      : undefined;
    if (hiddenFromSessionList !== undefined || customData !== undefined) {
      await this.sessionIndexReady;
      const store = this.sessionIndex?.getStore();
      if (store) {
        await store.resolveTranscriptPath(conversationId);
        const existing = getSessionMetadata(conversationId);
        if (existing && existing.messageCount === 0) {
          await store.updateMetadata(conversationId, {
            ...(hiddenFromSessionList !== undefined ? { hiddenFromSessionList } : {}),
            ...(customData ? { customData: { ...(existing.customData ?? {}), ...customData } } : {}),
          });
        }
      }
    }
  }

  async compactSession(
    conversationId: string,
    options?: { force?: boolean; instructions?: string },
  ): Promise<TuiCompactionResult> {
    if (!this.agent) return { compacted: false, summary: 'Agent not started' };
    try {
      const result = await this.agent.sessionInspector.compact(conversationId, {
        force: options?.force ?? true,
        instructions: options?.instructions,
      });
      if (!result.compacted) return { compacted: false, summary: 'Nothing to compact' };
      return {
        compacted: true,
        summary: `Compacted (${result.tokensBefore ?? '?'} → ${result.tokensAfter ?? '?'} tokens)`,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        transcriptSummary: result.summary,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { compacted: false, summary: errorMessage };
    }
  }

  async exportSession(conversationId: string, format: ExportFormat): Promise<string> {
    if (this.drafts.read(conversationId) && !getSessionMetadata(conversationId)) {
      throw new Error('This conversation is an unsent draft; there is no persisted transcript yet.');
    }
    await this.sessionIndexReady;
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) throw new Error('Session store is unavailable.');
    return store.exportSession(conversationId, format);
  }

  async importSession(
    targetConversationId: string,
    jsonContent: string,
  ): Promise<{ conversationId: string; rowCount: number }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    return this.agent.sessionStore.importSessionExport(targetConversationId, jsonContent);
  }

  async createShare(
    _conversationId: string,
    request: TuiShareRequest,
    _options?: { agentId?: string },
  ): Promise<TuiShareResult> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    const config = this.activeConfig();
    if (!isShareToolAvailable(config)) {
      throw new Error('Sharing is disabled in gateway config');
    }
    const workspace = getWorkspacePath(config);
    const tool = createCreateShareTool({
      workspace,
      getConfig: () => config,
      getAgentId: () => 'tui',
    });
    const result = await tool.execute(
      'tui-share',
      {
        filePath: request.path,
        audience: request.audience,
        mode: request.mode,
        title: request.title,
        description: request.description,
      },
    );
    const details = (result.details ?? {}) as Record<string, unknown>;
    const error = typeof details.error === 'string' ? details.error : undefined;
    if (error) {
      throw new Error(error);
    }
    const shareUrl = typeof details.shareUrl === 'string' ? details.shareUrl : undefined;
    if (!shareUrl) {
      const text = result.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('\n')
        .trim();
      throw new Error(text || 'Share failed');
    }
    return {
      kind: typeof details.kind === 'string' ? details.kind : 'share',
      shareUrl,
      title: typeof details.title === 'string' ? details.title : undefined,
      description: typeof details.description === 'string' ? details.description : undefined,
      thumbnailUrl: typeof details.thumbnailUrl === 'string' ? details.thumbnailUrl : undefined,
      reachability: typeof details.reachability === 'string' ? details.reachability : undefined,
      reachabilityHint:
        typeof details.reachabilityHint === 'string' ? details.reachabilityHint : undefined,
      expiresAt: typeof details.expiresAt === 'string' ? details.expiresAt : undefined,
      maxViews: typeof details.maxViews === 'number' ? details.maxViews : null,
      routingReason:
        typeof (details.routing as { reason?: unknown } | undefined)?.reason === 'string'
          ? ((details.routing as { reason: string }).reason)
          : undefined,
      routingHint:
        typeof (details.routing as { hint?: unknown } | undefined)?.hint === 'string'
          ? ((details.routing as { hint: string }).hint)
          : undefined,
    };
  }

  async sideQuery(conversationId: string, question: string, options?: { signal?: AbortSignal; onDelta?: (text: string) => void }): Promise<{ text: string; error?: string }> {
    const agent = await this.ensureAgent();
    const draft = this.drafts.read(conversationId);
    return agent.sessionInspector.btwQuery(conversationId, question, { signal: options?.signal, onTextDelta: options?.onDelta,
      ...(draft ? { agentId: draft.creation.agentId, modelRef: draft.creation.model, includeSessionContext: false } : {}) });
  }

  async forkSession(
    sourceConversationId: string,
    targetConversationId: string,
  ): Promise<{ conversationId: string; rowCount: number }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    return this.agent.sessionStore.forkSession(sourceConversationId, targetConversationId);
  }

  async forkSessionAt(
    sourceConversationId: string,
    targetConversationId: string,
    entryId: string,
  ): Promise<{ conversationId: string; rowCount: number }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    const throughRow = transcriptTreeEntryIdToRowNumber(entryId);
    if (throughRow == null) {
      throw new Error(`Invalid transcript entry: ${entryId}`);
    }
    return this.agent.sessionStore.forkSessionRows(sourceConversationId, targetConversationId, { throughRow });
  }

  async setTranscriptLabel(
    conversationId: string,
    entryId: string,
    label: string | undefined,
  ): Promise<{ ok: boolean }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    await this.agent.sessionStore.appendTranscriptLabelEntry(conversationId, { targetId: entryId, label });
    return { ok: true };
  }

  async appendCustomEntry(
    conversationId: string,
    customType: string,
    data?: unknown,
  ): Promise<{ ok: boolean }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    await this.agent.sessionStore.appendTranscriptCustomEntry(conversationId, { customType, data });
    return { ok: true };
  }

  async appendCustomMessage(
    conversationId: string,
    message: {
      customType: string;
      content?: string | unknown[];
      display?: boolean;
      details?: unknown;
    },
  ): Promise<{ ok: boolean }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    await this.agent.sessionStore.appendTranscriptCustomMessageEntry(conversationId, message);
    evictEmbeddedSessionRunner(conversationId, 'tui_custom_message_appended');
    return { ok: true };
  }

  async appendBashExecution(
    conversationId: string,
    entry: {
      command: string;
      output?: string;
      exitCode?: number | null;
      signal?: string | null;
      excludeFromContext?: boolean;
      truncated?: boolean;
      fullOutputPath?: string;
    },
  ): Promise<{ ok: boolean }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    await this.agent.sessionStore.appendTranscriptBashExecutionEntry(conversationId, entry);
    evictEmbeddedSessionRunner(conversationId, 'tui_bash_execution_appended');
    return { ok: true };
  }

  private processOutbound(): void {
    void (async () => {
      while (this.running) {
        try {
          const msg = await this.bus.consumeOutbound();
          log.debug({ channel: msg.channel, chatId: msg.chat_id }, 'Outbound message');
        } catch (error) {
          if (error instanceof MessageBusShutdownError) break;
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.warn({ err: error, errorMessage }, `Outbound processor failed: ${errorMessage}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    })();
  }
}
