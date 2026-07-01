import type { ExtensionRegistryImpl } from '../../extensions/loader.js';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AgentService } from '../../agent/service.js';
import { listAgentEntries, normalizeAgentId } from '../../agent/agent-scope.js';
import { resolveAgentIdFromSessionKey } from '../../routing/agent-session-key.js';
import { parseModelRef } from '../../agent/models/selection.js';
import { createCreateShareTool, isShareToolAvailable } from '../../agent/tools/create-share-tool.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { getAgentDefaultModelRef } from '../../config/schema.js';
import { MessageBus, MessageBusShutdownError } from '../../infra/bus/index.js';
import { evictEmbeddedSessionRunner } from '../../agent/embedded/session-runner.js';
import type { ExportFormat } from '../../session/types.js';
import { SessionIndex } from '../../session/index.js';
import { openXopcDatabase } from '../../storage/sqlite/index.js';
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
} from '../tui-backend.js';
import type { SessionInfo } from '../tui-types.js';
import { sessionMetadataToTuiItem } from '../tui-session-format.js';
import { computeTuiSessionStats } from '../tui-session-stats.js';
import { buildTuiTranscriptTree, transcriptTreeEntryIdToRowNumber } from '../tui-transcript-tree.js';
import { ChatStreamMapper } from '../../gateway/chat-stream/mapper.js';
import { collectTuiStartupResources } from '../tui-startup-resources.js';
import { fuzzySearchWorkspaceFiles } from '../../gateway/workspace-file-search.js';

const log = createLogger('TUI:Embedded');

interface EmbeddedBackendOptions {
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
  private config: ReturnType<typeof loadConfig> | null = null;
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

  start(): void {
    if (this.running) return;
    this.running = true;

    const config = loadConfig();
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
      throw new Error('Embedded backend not started');
    }

    this.agentLoading = this.createAgent(this.config, this.sessionIndex);
    try {
      return await this.agentLoading;
    } finally {
      this.agentLoading = null;
    }
  }

  private async createAgent(config: ReturnType<typeof loadConfig>, sessionIndex: SessionIndex): Promise<AgentService> {
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
      isWorkspaceTrusted: (workspaceDir) => {
        const explicit = this.opts?.isWorkspaceTrusted?.(workspaceDir);
        if (explicit !== undefined && explicit !== null) {
          return explicit;
        }
        const implicit = this.opts?.implicitTrustedWorkspace;
        if (implicit && isPathSameOrInside(implicit, workspaceDir)) {
          return true;
        }
        return undefined;
      },
    });
    this.agent = agent;
    await agent.start();
    return agent;
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

  async getStartupResources(sessionKey: string) {
    return collectTuiStartupResources(loadConfig(), sessionKey);
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

  async steerChat(opts: { sessionKey: string; message: string }): Promise<{ ok: boolean }> {
    if (!this.agent) return { ok: false };
    const ok = await this.agent.turnDispatcher.steerWebchatSession(opts.sessionKey, opts.message);
    return { ok };
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

  async getSessionStats(sessionKey: string): Promise<TuiSessionStats> {
    if (!this.agent) return computeTuiSessionStats([]);
    try {
      const rows = await this.agent.sessionStore.loadTranscriptRows(sessionKey);
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
    const config = loadConfig();
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
    if (!this.agent) return { ok: false };
    try {
      const ok = await this.agent.sessionStore.deleteSession(sessionKey);
      return { ok };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Embedded deleteSession failed: ${errorMessage}`);
      return { ok: false };
    }
  }

  async getSessionInfo(sessionKey: string): Promise<SessionInfo> {
    if (!this.agent) {
      const config = loadConfig();
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
      const config = loadConfig();
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

  async resetSession(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    await this.agent.resetSession(sessionKey);
  }

  async patchSession(
    sessionKey: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    if (!this.agent) return;
    const result = await this.agent.sessionConfig.patch(sessionKey, {
      model: typeof patch.model === 'string' ? patch.model : undefined,
      thinkingLevel: typeof patch.thinkingLevel === 'string' ? patch.thinkingLevel : undefined,
      reasoningLevel: typeof patch.reasoningLevel === 'string' ? patch.reasoningLevel : undefined,
      verboseLevel: typeof patch.verboseLevel === 'string' ? patch.verboseLevel : undefined,
      workingDirectory: typeof patch.workingDirectory === 'string' ? patch.workingDirectory : undefined,
    });
    if (!result.ok) {
      throw new Error(result.error);
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
    const config = loadConfig();
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
