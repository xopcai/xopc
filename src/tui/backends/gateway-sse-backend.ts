import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { createLogger } from '../../utils/logger.js';
import { consumeSSEStream, parseSSEData } from '../sse-consumer.js';
import type {
  ChatSendOptions,
  HistoryMessage,
  TuiBackend,
  TuiEvent,
  TuiModelChoice,
  TuiSessionItem,
} from '../tui-backend.js';
import type { SessionInfo } from '../tui-types.js';

const log = createLogger('TUI:GatewaySSE');

interface GatewaySSEOptions {
  url: string;
  token?: string;
}

/** Fetch wrapper that adds auth headers. */
async function gatewayFetch(
  baseUrl: string,
  path: string,
  token: string | undefined,
  init?: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

/**
 * TUI backend that communicates with a running xopc gateway via HTTP + SSE.
 *
 * - Agent streaming: `POST /api/agent` with `Accept: text/event-stream`
 * - Broadcast events: `GET /api/events` via long-lived SSE
 * - REST calls for sessions, models, etc.
 */
export class GatewaySseBackend implements TuiBackend {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private eventAbort: AbortController | null = null;
  private chatAbort: AbortController | null = null;

  onEvent?: (evt: TuiEvent) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onGap?: (info: { expected: number; received: number }) => void;

  constructor(opts: GatewaySSEOptions) {
    this.baseUrl = opts.url.replace(/\/+$/, '');
    this.token = opts.token;
  }

  get connectionLabel(): string {
    return this.baseUrl;
  }

  start(): void {
    this.startEventStream();
  }

  stop(): void {
    this.eventAbort?.abort();
    this.eventAbort = null;
    this.chatAbort?.abort();
    this.chatAbort = null;
  }

  // ── Agent chat (POST /api/agent → SSE response body) ──

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    const signal = this.chatAbort.signal;
    const runId = crypto.randomUUID();

    // Match EmbeddedBackend: set activeRunId before any token/tool events so TUI state stays on one
    // runId (avoids assistant under "default" and tools under the real uuid).
    this.onEvent?.({ event: 'status', data: { status: 'started', runId } });

    // Fire-and-forget: run the HTTP request + SSE consumption in background
    // so the TUI event loop stays responsive for keyboard input.
    void (async () => {
      try {
        const res = await gatewayFetch(this.baseUrl, '/api/agent', this.token, {
          method: 'POST',
          headers: { Accept: 'text/event-stream' },
          body: JSON.stringify({
            // Prepend envelope timestamp for regular messages so the model knows
            // the current date/time. Skip for slash commands — parseSlashCommand
            // requires lines starting with '/'.
            message: opts.message.trimStart().startsWith('/')
              ? opts.message
              : prependEnvelopeTimestamp(opts.message),
            channel: 'webchat',
            sessionKey: opts.sessionKey,
            thinking: opts.thinking,
          }),
          signal,
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          this.onEvent?.({
            event: 'error',
            data: { content: body.error?.message ?? `Gateway error: ${res.status}` },
          });
          return;
        }

        const contentType = res.headers.get('Content-Type') ?? '';

        if (contentType.includes('text/event-stream') && res.body) {
          await consumeSSEStream(
            res.body,
            (sseEvent) => {
              if (signal.aborted) return;
              const data = parseSSEData<Record<string, unknown>>(sseEvent.data);
              if (!data) return;
              this.onEvent?.({ event: sseEvent.event, data });
            },
            signal,
          );
        } else {
          const json = (await res.json()) as { ok?: boolean; payload?: { content?: string } };
          if (json.ok && json.payload?.content) {
            this.onEvent?.({
              event: 'token',
              data: { content: json.payload.content },
            });
            this.onEvent?.({ event: 'result', data: { ok: true } });
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.onEvent?.({ event: 'error', data: { content: errorMessage } });
      }
    })();

    return { runId };
  }

  async abortChat(opts: { sessionKey: string; runId: string }): Promise<{ ok: boolean }> {
    this.chatAbort?.abort();
    this.chatAbort = null;
    try {
      const res = await gatewayFetch(this.baseUrl, '/api/agent/abort', this.token, {
        method: 'POST',
        body: JSON.stringify({ runId: opts.runId }),
      });
      const json = (await res.json()) as { ok?: boolean };
      return { ok: json.ok ?? false };
    } catch {
      return { ok: false };
    }
  }

  // ── REST helpers ──

  async loadHistory(opts: {
    sessionKey: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }> {
    try {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      const qs = params.toString();
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(opts.sessionKey)}/messages${qs ? `?${qs}` : ''}`,
        this.token,
      );
      if (!res.ok) return { messages: [] };
      const json = (await res.json()) as { ok?: boolean; payload?: { messages?: HistoryMessage[] } };
      return { messages: json.payload?.messages ?? [] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Failed to load history: ${errorMessage}`);
      return { messages: [] };
    }
  }

  async listSessions(): Promise<TuiSessionItem[]> {
    try {
      const res = await gatewayFetch(this.baseUrl, '/api/sessions', this.token);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        items?: Array<{
          key: string;
          name?: string;
          updatedAt?: string;
          estimatedTokens?: number;
          customData?: Record<string, unknown>;
        }>;
      };
      return (json.items ?? []).map((s) => ({
        key: s.key,
        displayName: s.name,
        updatedAt: s.updatedAt ? Date.parse(s.updatedAt) : undefined,
        totalTokens: s.estimatedTokens ?? null,
        model:
          typeof s.customData?.model === 'string'
            ? s.customData.model
            : typeof s.customData?.modelRef === 'string'
              ? s.customData.modelRef
              : null,
      }));
    } catch {
      return [];
    }
  }

  async getSessionInfo(sessionKey: string): Promise<SessionInfo> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}`,
        this.token,
      );
      if (!res.ok) return {};
      const json = (await res.json()) as {
        session?: {
          name?: string;
          estimatedTokens?: number;
          customData?: Record<string, unknown>;
        };
      };
      const s = json.session;
      if (!s) return {};
      return {
        displayName: s.name,
        totalTokens: s.estimatedTokens ?? undefined,
        model:
          typeof s.customData?.model === 'string'
            ? s.customData.model
            : typeof s.customData?.modelRef === 'string'
              ? s.customData.modelRef
              : undefined,
        modelProvider:
          typeof s.customData?.modelProvider === 'string' ? s.customData.modelProvider : undefined,
      };
    } catch {
      return {};
    }
  }

  async listModels(): Promise<TuiModelChoice[]> {
    try {
      const res = await gatewayFetch(this.baseUrl, '/api/models', this.token);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        ok?: boolean;
        payload?: { models?: TuiModelChoice[] };
      };
      return json.payload?.models ?? [];
    } catch {
      return [];
    }
  }

  async resetSession(sessionKey: string): Promise<void> {
    await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}`,
      this.token,
      { method: 'DELETE' },
    ).catch(() => {});
  }

  async patchSession(sessionKey: string, patch: Record<string, unknown>): Promise<void> {
    await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}`,
      this.token,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ).catch(() => {});
  }

  // ── Broadcast SSE (GET /api/events) ──

  private startEventStream(): void {
    this.eventAbort?.abort();
    this.eventAbort = new AbortController();

    const url = new URL(`${this.baseUrl}/api/events`);
    if (this.token) url.searchParams.set('token', this.token);

    const connect = async () => {
      try {
        const res = await fetch(url.toString(), {
          signal: this.eventAbort!.signal,
          headers: { Accept: 'text/event-stream' },
        });

        if (!res.ok || !res.body) {
          this.onDisconnected?.(`event stream error: ${res.status}`);
          this.scheduleReconnect();
          return;
        }

        this.onConnected?.();

        await consumeSSEStream(
          res.body,
          (sseEvent) => {
            if (sseEvent.event === 'connected') return;
            if (sseEvent.event === 'gap') {
              const gapData = parseSSEData(sseEvent.data) as {
                expected?: unknown;
                received?: unknown;
              } | null;
              if (
                gapData &&
                typeof gapData.expected === 'number' &&
                typeof gapData.received === 'number'
              ) {
                this.onGap?.({ expected: gapData.expected, received: gapData.received });
              }
              return;
            }
            const data = parseSSEData(sseEvent.data);
            if (data !== null) {
              this.onEvent?.({ event: sseEvent.event, data });
            }
          },
          this.eventAbort!.signal,
        );

        // Stream ended normally
        if (!this.eventAbort?.signal.aborted) {
          this.onDisconnected?.('stream closed');
          this.scheduleReconnect();
        }
      } catch (error) {
        if (this.eventAbort?.signal.aborted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.warn({ err: error, errorMessage }, `Event stream failed: ${errorMessage}`);
        this.onDisconnected?.(errorMessage);
        this.scheduleReconnect();
      }
    };

    void connect();
  }

  private scheduleReconnect(): void {
    if (this.eventAbort?.signal.aborted) return;
    setTimeout(() => {
      if (!this.eventAbort?.signal.aborted) {
        this.startEventStream();
      }
    }, 3000);
  }
}
