import type { ExtensionRegistryImpl } from '../../extensions/loader.js';
import { AgentService } from '../../agent/index.js';
import { parseModelRef } from '../../agent/models/selection.js';
import { messagesToClientHistory } from '../../session/client-history.js';
import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { MessageBus, MessageBusShutdownError } from '../../infra/bus/index.js';
import { getAllProviders, getModelsByProvider } from '../../providers/index.js';
import { createLogger } from '../../utils/logger.js';
import type {
  ChatSendOptions,
  HistoryMessage,
  TuiBackend,
  TuiEvent,
  TuiModelChoice,
  TuiSessionItem,
} from '../tui-backend.js';
import type { SessionInfo } from '../tui-types.js';
import { sessionMetadataToTuiItem } from '../tui-session-format.js';

const log = createLogger('TUI:Embedded');

/**
 * TUI backend that runs the agent in-process (no gateway required).
 *
 * Wraps `AgentService` directly and emits TuiEvents by observing the
 * `MessageBus` output stream.
 */
export class EmbeddedBackend implements TuiBackend {
  private bus: MessageBus;
  private agent: AgentService | null = null;
  private running = false;
  private chatAbort: AbortController | null = null;

  onEvent?: (evt: TuiEvent) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;

  constructor(private readonly opts?: { extensionRegistry?: ExtensionRegistryImpl }) {
    this.bus = new MessageBus();
  }

  get connectionLabel(): string {
    return 'local embedded';
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const config = loadConfig();
    const workspace = getWorkspacePath(config);
    const modelConfig = config.agents?.defaults?.model;
    const modelId = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary;

    this.agent = new AgentService(this.bus, {
      workspace: workspace ?? process.cwd(),
      model: modelId,
      config,
      extensionRegistry: this.opts?.extensionRegistry,
    });

    this.agent.start().catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err, errorMessage }, `Embedded agent failed: ${errorMessage}`);
      this.onDisconnected?.(errorMessage);
    });

    // Process outbound messages in background
    this.processOutbound();

    // Signal ready
    queueMicrotask(() => this.onConnected?.());
  }

  stop(): void {
    this.running = false;
    this.chatAbort?.abort();
    this.chatAbort = null;
    this.bus.shutdown();
    void this.agent?.stop();
    this.agent = null;
  }

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    if (!this.agent) throw new Error('Agent not started');

    const runId = crypto.randomUUID();
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    const signal = this.chatAbort.signal;

    this.onEvent?.({ event: 'status', data: { status: 'started', runId } });

    // Run the stream in background so the TUI event loop stays responsive.
    void (async () => {
      try {
        // Prepend envelope timestamp so the model knows the current date/time,
        // matching the behavior of channel pipelines (Telegram, Weixin, etc.).
        // Skip for slash commands — parseSlashCommand requires lines starting with '/'.
        const messageForAgent = opts.message.trimStart().startsWith('/')
          ? opts.message
          : prependEnvelopeTimestamp(opts.message);

        const stream = this.agent!.turnDispatcher.processDirectStreaming(
          messageForAgent,
          opts.sessionKey,
          undefined,
          opts.thinking,
          { signal },
        );

        for await (const event of stream) {
          if (signal.aborted) break;
          this.onEvent?.({ event: event.type, data: event });
        }

        if (!signal.aborted) {
          this.onEvent?.({
            event: 'result',
            data: { ok: true },
          });
        }
      } catch (error) {
        if (signal.aborted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.onEvent?.({ event: 'error', data: { content: errorMessage } });
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
      const detail = await this.agent.sessionStore.get(opts.sessionKey);
      if (!detail) {
        return { messages: [] };
      }
      return {
        messages: messagesToClientHistory(detail.messages, { limit: opts.limit }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Embedded loadHistory failed: ${errorMessage}`);
      return { messages: [] };
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
      const modelConfig = config.agents?.defaults?.model;
      const model = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary;
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
        totalTokens: usage.estimatedTokens,
        contextWindow: usage.contextWindow,
        contextUsagePercent: usage.usagePercent,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err, sessionKey, errorMessage }, `getSessionInfo failed: ${errorMessage}`);
      const config = loadConfig();
      const modelConfig = config.agents?.defaults?.model;
      const model = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary;
      return { model: model ?? undefined };
    }
  }

  async listModels(): Promise<TuiModelChoice[]> {
    const choices: TuiModelChoice[] = [];
    for (const provider of getAllProviders()) {
      for (const model of getModelsByProvider(provider)) {
        choices.push({
          id: model.id,
          name: model.name ?? model.id,
          provider,
        });
      }
    }
    return choices;
  }

  async resetSession(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    await this.agent.clearSessionMessages(sessionKey);
  }

  async patchSession(
    _sessionKey: string,
    _patch: Record<string, unknown>,
  ): Promise<void> {
    // Not supported in embedded mode
  }

  async compactSession(
    sessionKey: string,
    options?: { force?: boolean },
  ): Promise<{ compacted: boolean; summary?: string }> {
    if (!this.agent) return { compacted: false, summary: 'Agent not started' };
    try {
      const result = await this.agent.sessionInspector.compact(sessionKey, { force: options?.force ?? true });
      const summary = result.compacted
        ? `Compacted (${result.tokensBefore ?? '?'} → ${result.tokensAfter ?? '?'} tokens)`
        : 'Nothing to compact';
      return { compacted: result.compacted, summary };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { compacted: false, summary: errorMessage };
    }
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
