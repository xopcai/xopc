import type { ExtensionRegistryImpl } from '../../extensions/loader.js';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AgentService } from '../../agent/service.js';
import { listAgentEntries, normalizeAgentId } from '../../agent/agent-scope.js';
import { resolveAgentIdFromSessionKey } from '../../routing/agent-session-key.js';
import { parseModelRef } from '../../agent/models/selection.js';
import { createCreateShareTool, isShareToolAvailable } from '../../agent/tools/create-share-tool.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { buildSessionTimeline, type SessionTimelineItem } from '../../session/transcript-outline.js';
import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { loadConfig, getWorkspacePath, saveConfig } from '../../config/index.js';
import { getAgentDefaultModelRef, type Config } from '../../config/schema.js';
import { setTuiDefaultAgentConfig } from '../../commands/agents.config.js';
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
} from '../tui-backend.js';
import type { SessionInfo } from '../tui-types.js';
import { sessionMetadataToTuiItem } from '../tui-session-format.js';
import { computeTuiSessionStats } from '../tui-session-stats.js';
import { buildTuiTranscriptTree, transcriptTreeEntryIdToRowNumber } from '../tui-transcript-tree.js';
import { ChatStreamMapper } from '../../gateway/chat-stream/mapper.js';
import { collectTuiStartupResources } from '../tui-startup-resources.js';
import { fuzzySearchWorkspaceFiles } from '../../gateway/workspace-file-search.js';
import { inferSuggestedProjectDefaultAgentId, ProjectService } from '../../projects/index.js';

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
    const modelId = getAgentDefaultModelRef(config);
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
      const { XopcCloudModelSource } = await import('../../providers/xopc-cloud-model-source.js');
      const result = await new XopcCloudModelSource().refresh();
      if (result.status === 'updated') {
        log.info(
          { modelCount: result.modelCount },
          `XOPC Cloud model catalog refreshed: ${result.modelCount} models`,
        );
      }
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
        getModelForSession: (sessionKey) => this.agent!.getModelForSession(sessionKey),
      },
      sessionIndexInstance: this.sessionIndex,
      emit: (event, payload) => {
        this.onEvent?.({
          event,
          data: payload,
          source: 'broadcast',
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

  async getStartupResources(sessionKey: string) {
    return collectTuiStartupResources(this.activeConfig(), sessionKey, {
      isWorkspaceTrusted: (workspaceDir) => this.isWorkspaceTrusted(workspaceDir),
    });
  }

  refreshWorkspaceTrust(): void {
    this.agent?.refreshSkillsAfterTrustChange();
  }

  async startWorkflowRun(opts: TuiWorkflowRunStartRequest): Promise<TuiWorkflowRunStartResult> {
    await this.sessionIndexReady;
    const agentId = opts.agentId?.trim() || resolveAgentIdFromSessionKey(opts.sessionKey);
    const result = await this.getWorkflowRunService().startWorkflowRun({
      agentId,
      definitionId: opts.definitionId,
      parentSessionKey: opts.sessionKey,
      source: { kind: 'chat', sessionKey: opts.sessionKey },
      goal: opts.goal,
      input: opts.input,
    });
    if (result.ok === false) {
      throw new Error(result.message);
    }
    return {
      runId: result.runId,
      sessionKey: result.sessionKey,
      definitionId: opts.definitionId,
    };
  }

  async resolveStartupProject(opts: {
    workspacePath: string;
    sessionKey: string;
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
    if (!getSessionMetadata(opts.sessionKey)) {
      await this.sessionIndex.getStore().resolveTranscriptPath(opts.sessionKey, {
        metadata: {
          sourceChannel: 'tui',
          sourceChatId: `default:direct:${opts.sessionKey}`,
          sessionType: 'chat',
          projectId: match.project.id,
          routing: {
            agentId: opts.agentId,
            source: 'tui',
            accountId: 'default',
            peerKind: 'direct',
            peerId: opts.sessionKey,
          },
        },
      });
    }
    projects.attachSession(opts.sessionKey, match.project.id);
    return { project: match.project, created: match.created, reason: match.reason };
  }

  async searchWorkspaceFiles(
    sessionKey: string,
    query: string,
    options?: { limit?: number },
  ): Promise<TuiWorkspaceFileSearchEntry[]> {
    if (!this.agent) return [];
    try {
      const workspaceRoot = await this.agent.getEffectiveWorkspacePathForSession(sessionKey);
      return await fuzzySearchWorkspaceFiles(workspaceRoot, query, options?.limit ?? 15);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Embedded workspace file search failed: ${errorMessage}`);
      return [];
    }
  }

  async getReviewContext(sessionKey: string) {
    const config = this.activeConfig();
    const metadata = getSessionMetadata(sessionKey);
    const project = metadata?.projectId ? new ProjectService().get(metadata.projectId) : null;
    const workspace = effectiveWorkspacePathForSession(config, sessionKey, null, project);
    const cwd = await resolveGitRoot(workspace);
    return buildReviewContext(cwd);
  }

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    const agent = await this.ensureAgent();

    const runId = crypto.randomUUID();
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    const signal = this.chatAbort.signal;

    const mapper = new ChatStreamMapper({ runId, sessionKey: opts.sessionKey, channel: 'tui' });
    for (const event of mapper.start()) {
      this.onEvent?.({ event: event.type, data: event, source: 'embedded' });
    }

    // Run the stream in background so the TUI event loop stays responsive.
    void (async () => {
      try {
        // Prepend envelope timestamp so the model knows the current date/time,
        // matching the behavior of channel pipelines (Telegram, Weixin, etc.).
        // Skip for slash commands — parseSlashCommand requires lines starting with '/'.
        const messageForAgent = opts.message.trimStart().startsWith('/')
          ? opts.message
          : prependEnvelopeTimestamp(opts.message);

        const stream = agent.turnDispatcher.processDirectStreaming(
          messageForAgent,
          opts.sessionKey,
          opts.attachments,
          opts.thinking,
          { signal, runId },
        );

        for await (const event of stream) {
          if (signal.aborted) break;
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

  async abortChat(_opts: { sessionKey: string; runId: string }): Promise<{ ok: boolean }> {
    if (this.chatAbort) {
      this.chatAbort.abort();
      this.chatAbort = null;
      return { ok: true };
    }
    return { ok: false };
  }

  async submitChatInput(opts: { sessionKey: string; message: string; delivery: 'next' | 'steer' }): Promise<{ ok: boolean; effectiveDelivery?: 'next' | 'steer' }> {
    if (!this.agent) return { ok: false };
    if (opts.delivery === 'steer') {
      const ok = await this.agent.turnDispatcher.steerWebchatSession(opts.sessionKey, opts.message);
      return { ok, effectiveDelivery: ok ? 'steer' : undefined };
    }
    const { getEmbeddedRunBySessionKey } = await import('../../agent/embedded/runs.js');
    const handle = getEmbeddedRunBySessionKey(opts.sessionKey);
    if (!handle) return { ok: false };
    await handle.session.followUp(opts.message);
    return { ok: true, effectiveDelivery: 'next' };
  }

  async getChatInputState(sessionKey: string) {
    const { getEmbeddedRunBySessionKey } = await import('../../agent/embedded/runs.js');
    const handle = getEmbeddedRunBySessionKey(sessionKey);
    return {
      sessionKey,
      revision: 0,
      inputs: Array.from({ length: handle?.session.pendingMessageCount ?? 0 }, (_, index) => ({ id: String(index), status: 'queued' })),
    };
  }

  async loadHistory(opts: {
    sessionKey: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }> {
    if (!this.agent) {
      return { messages: [] };
    }
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(opts.sessionKey);
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
    sessionKey: string;
    rowNumber: number;
    before?: number;
    after?: number;
  }) {
    if (!this.agent) {
      return { messages: [], startRowNumber: 0, endRowNumber: 0, totalRows: 0 };
    }
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(opts.sessionKey);
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
        { err: error, sessionKey: opts.sessionKey, rowNumber: opts.rowNumber, errorMessage },
        `Embedded loadHistoryWindow failed: ${errorMessage}`,
      );
      return { messages: [], startRowNumber: 0, endRowNumber: 0, totalRows: 0 };
    }
  }

  async loadTranscriptTree(sessionKey: string): Promise<TuiTranscriptTreeEntry[]> {
    if (!this.agent) return [];
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(sessionKey);
      return buildTuiTranscriptTree(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Embedded loadTranscriptTree failed: ${errorMessage}`);
      return [];
    }
  }

  async loadTimeline(sessionKey: string): Promise<SessionTimelineItem[]> {
    if (!this.agent) return [];
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(sessionKey);
      return buildSessionTimeline(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Embedded loadTimeline failed: ${errorMessage}`);
      return [];
    }
  }

  async getSessionStats(sessionKey: string): Promise<TuiSessionStats> {
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) return computeTuiSessionStats([]);
    try {
      const rows = await store.loadTranscriptRows(sessionKey);
      return computeTuiSessionStats(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Embedded getSessionStats failed: ${errorMessage}`);
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
    const config = this.activeConfig();
    const agents = new Map<string, TuiAgentInfo>();
    for (const entry of listAgentEntries(config)) {
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
    const result = setTuiDefaultAgentConfig(this.activeConfig(), agentId);
    if (result.ok === false) {
      throw new Error(result.message);
    }
    await saveConfig(result.config);
    this.config = result.config;
    return { agentId: result.agentId };
  }

  async renameSession(sessionKey: string, name: string): Promise<{ ok: boolean }> {
    if (!this.agent) return { ok: false };
    try {
      await this.agent.sessionStore.updateMetadata(sessionKey, { name: name.trim() });
      return { ok: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Embedded renameSession failed: ${errorMessage}`);
      return { ok: false };
    }
  }

  async deleteSession(sessionKey: string): Promise<{ ok: boolean }> {
    const store = this.agent?.sessionStore ?? this.sessionIndex?.getStore();
    if (!store) return { ok: false };
    try {
      const ok = await store.deleteSession(sessionKey);
      return { ok };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Embedded deleteSession failed: ${errorMessage}`);
      return { ok: false };
    }
  }

  async getSessionInfo(sessionKey: string): Promise<SessionInfo> {
    if (!this.agent) {
      const config = this.activeConfig();
      const model = getAgentDefaultModelRef(config);
      return { model: model ?? undefined };
    }
    try {
      const cfg = await this.agent.sessionInspector.agentConfig(sessionKey);
      const parsed = parseModelRef(cfg.model);
      const usage = await this.agent.sessionInspector.contextUsage(sessionKey);
      return {
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
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err, sessionKey, errorMessage }, `getSessionInfo failed: ${errorMessage}`);
      const config = this.activeConfig();
      const model = getAgentDefaultModelRef(config);
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

  async resetSession(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    await this.agent.resetSession(sessionKey);
  }

  async patchSession(
    sessionKey: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const agent = await this.ensureAgent();
    const projectId = typeof patch.projectId === 'string' ? patch.projectId.trim() : '';
    const result = await agent.sessionConfig.patch(sessionKey, {
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
      await this.sessionIndex?.getStore().resolveTranscriptPath(sessionKey);
      new ProjectService().attachSession(sessionKey, projectId);
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
        await store.resolveTranscriptPath(sessionKey);
        const existing = getSessionMetadata(sessionKey);
        if (existing && existing.messageCount === 0) {
          await store.updateMetadata(sessionKey, {
            ...(hiddenFromSessionList !== undefined ? { hiddenFromSessionList } : {}),
            ...(customData ? { customData: { ...(existing.customData ?? {}), ...customData } } : {}),
          });
        }
      }
    }
  }

  async compactSession(
    sessionKey: string,
    options?: { force?: boolean; instructions?: string },
  ): Promise<TuiCompactionResult> {
    if (!this.agent) return { compacted: false, summary: 'Agent not started' };
    try {
      const result = await this.agent.sessionInspector.compact(sessionKey, {
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

  async exportSession(sessionKey: string, format: ExportFormat): Promise<string> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    return this.agent.sessionStore.exportSession(sessionKey, format);
  }

  async importSession(
    targetSessionKey: string,
    jsonContent: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    return this.agent.sessionStore.importSessionExport(targetSessionKey, jsonContent);
  }

  async createShare(
    _sessionKey: string,
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

  async btwQuery(sessionKey: string, question: string): Promise<{ text: string; error?: string }> {
    if (!this.agent) {
      return { text: '', error: 'Agent not started' };
    }
    return this.agent.sessionInspector.btwQuery(sessionKey, question);
  }

  async forkSession(
    sourceSessionKey: string,
    targetSessionKey: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    return this.agent.sessionStore.forkSession(sourceSessionKey, targetSessionKey);
  }

  async forkSessionAt(
    sourceSessionKey: string,
    targetSessionKey: string,
    entryId: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    const throughRow = transcriptTreeEntryIdToRowNumber(entryId);
    if (throughRow == null) {
      throw new Error(`Invalid transcript entry: ${entryId}`);
    }
    return this.agent.sessionStore.forkSessionRows(sourceSessionKey, targetSessionKey, { throughRow });
  }

  async setTranscriptLabel(
    sessionKey: string,
    entryId: string,
    label: string | undefined,
  ): Promise<{ ok: boolean }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    await this.agent.sessionStore.appendTranscriptLabelEntry(sessionKey, { targetId: entryId, label });
    return { ok: true };
  }

  async appendCustomEntry(
    sessionKey: string,
    customType: string,
    data?: unknown,
  ): Promise<{ ok: boolean }> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }
    await this.agent.sessionStore.appendTranscriptCustomEntry(sessionKey, { customType, data });
    return { ok: true };
  }

  async appendCustomMessage(
    sessionKey: string,
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
    await this.agent.sessionStore.appendTranscriptCustomMessageEntry(sessionKey, message);
    evictEmbeddedSessionRunner(sessionKey, 'tui_custom_message_appended');
    return { ok: true };
  }

  async appendBashExecution(
    sessionKey: string,
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
    await this.agent.sessionStore.appendTranscriptBashExecutionEntry(sessionKey, entry);
    evictEmbeddedSessionRunner(sessionKey, 'tui_bash_execution_appended');
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
