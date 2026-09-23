import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import type { ExtensionRegistryImpl } from '../../extensions/extension-registry-impl.js';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AgentService } from '../../agent/service.js';
import { listAgentEntries, normalizeAgentId } from '../../agent/agent-scope.js';
import { resolveAgentIdFromConversationId } from '../../routing/agent-session-key.js';
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
import type { ExportFormat } from '../../session/types.js';
import { SessionIndex } from '../../session/index.js';
import {
  appendComposerInputHistory,
  getSessionMetadata,
  listComposerInputHistory,
  openXopcDatabase,
} from '../../storage/sqlite/index.js';
import { buildWorkflowChildTools } from '../../agent/workflow/workflow-child-tools.js';
import type { GatewayWorkflowHost } from '../../gateway/gateway-workflow-host.types.js';
import { WorkflowRunService } from '../../workflows/service/workflow-run-service.js';
import { WorkflowSessionBridge } from '../../workflows/service/workflow-session-bridge.js';
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
  TuiWorkflowRunStartRequest,
  TuiWorkflowRunStartResult,
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
  return Math.min(200, Math.max(0, parsed));
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
  private workflowRunService: WorkflowRunService | null = null;
  private running = false;
  private chatAbort: AbortController | null = null;
  private readonly chatInputStates = new Map<string, TuiChatInputState>();

  onEvent?: (evt: TuiEvent) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;

  constructor(private readonly opts?: EmbeddedBackendOptions) {
    this.bus = new MessageBus();
  }

  get connectionLabel(): string {
    return 'local embedded';
  }

  async getComposerInputHistory(): Promise<TuiComposerHistoryItem[]> {
    return listComposerInputHistory();
  }

  async recordComposerInputHistory(text: string): Promise<TuiComposerHistoryItem> {
    return appendComposerInputHistory(text).item;
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
      getWorkflowRunService: () => this.getWorkflowRunService(),
      extensionRegistry: this.opts?.extensionRegistry,
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

  stop(): void {
    this.running = false;
    this.chatAbort?.abort();
    this.chatAbort = null;
    this.bus.shutdown();
    void this.agent?.stop();
    this.agent = null;
  }

  getActiveSignal(): AbortSignal | undefined {
    const signal = this.chatAbort?.signal;
    return signal && !signal.aborted ? signal : undefined;
  }

  private getWorkflowRunService(): WorkflowRunService {
    if (this.workflowRunService) return this.workflowRunService;
    if (!this.config || !this.sessionIndex || !this.agent) {
      throw new Error('Embedded workflow runtime is not ready.');
    }

    const host: GatewayWorkflowHost = {
      currentConfig: this.config,
      currentWorkspacePath: this.workspace,
      messageBusInstance: this.bus,
      agentService: {
        getModelForSession: (conversationId) => this.agent!.getModelForSession(conversationId),
      },
      sessionIndexInstance: this.sessionIndex,
      emit: (event, payload) => {
        this.onEvent?.({
          event,
          data: payload,
          source: 'embedded',
        });
      },
    };

    this.workflowRunService = new WorkflowRunService({
      service: host,
      sessionBridge: new WorkflowSessionBridge(host),
      buildChildTools: buildWorkflowChildTools,
    });
    return this.workflowRunService;
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
    return collectTuiStartupResources(this.activeConfig(), conversationId, {
      isWorkspaceTrusted: (workspaceDir) => this.isWorkspaceTrusted(workspaceDir),
    });
  }

  refreshWorkspaceTrust(): void {
    this.agent?.refreshSkillsAfterTrustChange();
  }

  async startWorkflowRun(opts: TuiWorkflowRunStartRequest): Promise<TuiWorkflowRunStartResult> {
    await this.sessionIndexReady;
    const agentId = opts.agentId?.trim() || resolveAgentIdFromConversationId(opts.conversationId);
    const result = await this.getWorkflowRunService().startWorkflowRun({
      agentId,
      definitionId: opts.definitionId,
      parentConversationId: opts.conversationId,
      source: { kind: 'chat', conversationId: opts.conversationId },
      goal: opts.goal,
      input: opts.input,
    });
    if (result.ok === false) {
      throw new Error(result.message);
    }
    return {
      runId: result.runId,
      conversationId: result.conversationId,
      definitionId: opts.definitionId,
    };
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
    if (!this.agent) return [];
    try {
      const workspaceRoot = await this.agent.getEffectiveWorkspacePathForSession(conversationId);
      return await fuzzySearchWorkspaceFiles(workspaceRoot, query, options?.limit ?? 15);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded workspace file search failed: ${errorMessage}`);
      return [];
    }
  }

  async getReviewContext(conversationId: string) {
    const config = this.activeConfig();
    const metadata = getSessionMetadata(conversationId);
    const project = metadata?.projectId ? new ProjectService().get(metadata.projectId) : null;
    const workspace = effectiveWorkspacePathForSession(config, conversationId, null, project);
    const cwd = await resolveGitRoot(workspace);
    return buildReviewContext(cwd);
  }

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    const agent = await this.ensureAgent();

    const runId = crypto.randomUUID();
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
        if (signal.aborted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        for (const mapped of mapper.error(errorMessage)) {
          this.onEvent?.({ event: mapped.type, data: mapped, source: 'embedded' });
        }
        for (const mapped of mapper.end('error', errorMessage)) {
          this.onEvent?.({ event: mapped.type, data: mapped, source: 'embedded' });
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
    return this.chatInputStates.get(conversationId) ?? { conversationId, revision: 0, inputs: [] };
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
    this.chatInputStates.set(state.conversationId, state);
    this.onEvent?.({ event: 'session.input-state', data: state, source: 'embedded' });
  }

  private async replaceEmbeddedQueue(conversationId: string, state: TuiChatInputState): Promise<boolean> {
    const { getEmbeddedRunByConversationId } = await import('../../agent/embedded/runs.js');
    const handle = getEmbeddedRunByConversationId(conversationId);
    if (!handle) return false;
    handle.session.clearQueue();
    for (const input of state.inputs) {
      if (input.status === 'injecting') await handle.session.steer(input.content);
      else await handle.session.followUp(input.content);
    }
    return true;
  }

  async loadHistory(opts: {
    conversationId: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }> {
    if (!this.agent) {
      return { messages: [] };
    }
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(opts.conversationId);
      return {
        messages: transcriptRowsToClientHistory(rows, { limit: opts.limit }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Embedded loadHistory failed: ${errorMessage}`);
      return { messages: [] };
    }
  }

  async loadHistoryWindow(opts: {
    conversationId: string;
    rowNumber: number;
    before?: number;
    after?: number;
  }) {
    if (!this.agent) {
      return { messages: [], startRowNumber: 0, endRowNumber: 0, totalRows: 0 };
    }
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(opts.conversationId);
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
      return { messages: [], startRowNumber: 0, endRowNumber: 0, totalRows: 0 };
    }
  }

  async loadTranscriptTree(conversationId: string): Promise<TuiTranscriptTreeEntry[]> {
    if (!this.agent) return [];
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(conversationId);
      return buildTuiTranscriptTree(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded loadTranscriptTree failed: ${errorMessage}`);
      return [];
    }
  }

  async loadTimeline(conversationId: string): Promise<SessionTimelineItem[]> {
    if (!this.agent) return [];
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(conversationId);
      return buildSessionTimeline(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded loadTimeline failed: ${errorMessage}`);
      return [];
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

  async listSessions(): Promise<TuiSessionItem[]> {
    if (!this.agent) return [];
    try {
      const result = await this.agent.sessionStore.list({
        limit: 200,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      return result.items.map(sessionMetadataToTuiItem);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Embedded listSessions failed: ${errorMessage}`);
      return [];
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
    if (!this.agent) return { ok: false };
    try {
      await this.agent.sessionStore.updateMetadata(conversationId, { name: name.trim() });
      return { ok: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded renameSession failed: ${errorMessage}`);
      return { ok: false };
    }
  }

  async deleteSession(conversationId: string): Promise<{ ok: boolean }> {
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) return { ok: false };
    try {
      const ok = await store.deleteSession(conversationId);
      return { ok };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Embedded deleteSession failed: ${errorMessage}`);
      return { ok: false };
    }
  }

  async createConversation(agentId: string, conversationId?: string): Promise<string> {
    return createConversation({ agentId, sourceChannel: 'tui', customData: { genericNewChatShell: true }, hiddenFromSessionList: true }, '', conversationId).key;
  }

  async getSessionInfo(conversationId: string): Promise<SessionInfo> {
    if (!this.agent) {
      const model = getAgentDefaultModelRef();
      return { model: model ?? undefined };
    }
    try {
      const cfg = await this.agent.sessionInspector.agentConfig(conversationId);
      const parsed = parseModelRef(cfg.model);
      const usage = await this.agent.sessionInspector.contextUsage(conversationId);
      return {
        agentId: getSessionMetadata(conversationId)?.agentId,
        generatedShell: getSessionMetadata(conversationId)?.customData?.genericNewChatShell === true,
        model: parsed?.model ?? cfg.model,
        modelProvider: parsed?.provider,
        thinkingLevel: cfg.thinkingLevel,
        reasoningLevel: cfg.reasoningLevel,
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
      const model = getAgentDefaultModelRef();
      return { model: model ?? undefined };
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
    const agent = await this.ensureAgent();
    const hasProjectPatch = Object.prototype.hasOwnProperty.call(patch, 'projectId');
    const projectId = typeof patch.projectId === 'string' ? patch.projectId.trim() : '';
    const result = await agent.sessionConfig.patch(conversationId, {
      model: typeof patch.model === 'string' ? patch.model : undefined,
      thinkingLevel: typeof patch.thinkingLevel === 'string' ? patch.thinkingLevel : undefined,
      reasoningLevel: typeof patch.reasoningLevel === 'string' ? patch.reasoningLevel : undefined,
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
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    return this.agent.sessionStore.exportSession(conversationId, format);
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

  async btwQuery(conversationId: string, question: string): Promise<{ text: string; error?: string }> {
    if (!this.agent) {
      return { text: '', error: 'Agent not started' };
    }
    return this.agent.sessionInspector.btwQuery(conversationId, question);
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
