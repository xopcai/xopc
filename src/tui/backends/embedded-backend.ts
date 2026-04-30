import { AgentService } from '../../agent/index.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { MessageBus, MessageBusShutdownError } from '../../infra/bus/index.js';
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

  constructor() {
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
        const stream = this.agent!.processDirectStreaming(
          opts.message,
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

  async loadHistory(_opts: {
    sessionKey: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }> {
    // Session history loading deferred to future iteration
    return { messages: [] };
  }

  async listSessions(): Promise<TuiSessionItem[]> {
    return [];
  }

  async getSessionInfo(_sessionKey: string): Promise<SessionInfo> {
    const config = loadConfig();
    const modelConfig = config.agents?.defaults?.model;
    const model = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary;
    return { model: model ?? undefined };
  }

  async listModels(): Promise<TuiModelChoice[]> {
    return [];
  }

  async resetSession(_sessionKey: string): Promise<void> {
    // Restart agent for a clean session
    this.stop();
    this.bus = new MessageBus();
    this.start();
  }

  async patchSession(
    _sessionKey: string,
    _patch: Record<string, unknown>,
  ): Promise<void> {
    // Not supported in embedded mode
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
