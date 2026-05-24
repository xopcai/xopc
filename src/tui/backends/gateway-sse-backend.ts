import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { parseModelRef } from '../../agent/models/selection.js';
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

  async steerChat(opts: { sessionKey: string; message: string }): Promise<{ ok: boolean }> {
    try {
      const res = await gatewayFetch(this.baseUrl, '/api/agent/steer', this.token, {
        method: 'POST',
        body: JSON.stringify({ chatId: opts.sessionKey, message: opts.message }),
      });
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as { ok?: boolean };
      return { ok: json.ok === true };
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
          messageCount?: number;
          customData?: Record<string, unknown>;
        }>;
      };
      return (json.items ?? []).map((s) => ({
        key: s.key,
        displayName: s.name,
        updatedAt: s.updatedAt ? Date.parse(s.updatedAt) : undefined,
        totalTokens: s.estimatedTokens ?? null,
        messageCount: typeof s.messageCount === 'number' ? s.messageCount : undefined,
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
    const out: SessionInfo = {};
    try {
      const sessionPath = `/api/sessions/${encodeURIComponent(sessionKey)}`;
      const [sessionRes, agentCfgRes] = await Promise.all([
        gatewayFetch(this.baseUrl, sessionPath, this.token),
        gatewayFetch(this.baseUrl, `${sessionPath}/agent-config`, this.token),
      ]);

      type SessionRow = {
        name?: string;
        estimatedTokens?: number;
        customData?: Record<string, unknown>;
      };
      let session: SessionRow | undefined;

      if (sessionRes.ok) {
        const json = (await sessionRes.json()) as { session?: SessionRow };
        session = json.session;
        if (session) {
          if (session.name) out.displayName = session.name;
          if (session.estimatedTokens != null) out.totalTokens = session.estimatedTokens;
        }
      }

      if (agentCfgRes.ok) {
        const json = (await agentCfgRes.json()) as {
          ok?: boolean;
          payload?: { model?: string; thinkingLevel?: string };
        };
        const p = json.payload;
        if (p?.model && typeof p.model === 'string') {
          const parsed = parseModelRef(p.model);
          if (parsed) {
            out.model = parsed.model;
            out.modelProvider = parsed.provider;
          } else {
            out.model = p.model;
          }
        }
        if (p?.thinkingLevel && typeof p.thinkingLevel === 'string') {
          out.thinkingLevel = p.thinkingLevel;
        }
      }

      if (!out.model && session?.customData) {
        const cd = session.customData;
        const ref =
          typeof cd.model === 'string'
            ? cd.model
            : typeof cd.modelRef === 'string'
              ? cd.modelRef
              : undefined;
        if (ref) {
          const parsed = parseModelRef(ref);
          if (parsed) {
            out.model = parsed.model;
            out.modelProvider = parsed.provider;
          } else {
            out.model = ref;
          }
        }
        if (!out.modelProvider && typeof cd.modelProvider === 'string') {
          out.modelProvider = cd.modelProvider;
        }
      }

      if (out.totalTokens != null) {
        const models = await this.listModels();
        const match = models.find(
          (m) =>
            m.id === out.model &&
            (!out.modelProvider || m.provider === out.modelProvider),
        );
        const contextWindow = match?.contextWindow ?? 128_000;
        out.contextWindow = contextWindow;
        out.contextUsagePercent =
          contextWindow > 0
            ? Math.min(100, Math.round((out.totalTokens / contextWindow) * 100))
            : null;
      }

      return out;
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

  async compactSession(
    sessionKey: string,
    options?: { force?: boolean },
  ): Promise<{ compacted: boolean; summary?: string }> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}/compaction/run`,
        this.token,
        {
          method: 'POST',
          body: JSON.stringify({ force: options?.force ?? true }),
        },
      );
      if (!res.ok) {
        return { compacted: false, summary: `Compaction failed (${res.status})` };
      }
      const json = (await res.json()) as {
        ok?: boolean;
        payload?: { result?: { compacted?: boolean; tokensBefore?: number; tokensAfter?: number } };
      };
      const result = json.payload?.result;
      if (!result?.compacted) {
        return { compacted: false, summary: 'Nothing to compact' };
      }
      return {
        compacted: true,
        summary: `Compacted (${result.tokensBefore ?? '?'} → ${result.tokensAfter ?? '?'} tokens)`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { compacted: false, summary: errorMessage };
    }
  }

  async patchSession(sessionKey: string, patch: Record<string, unknown>): Promise<void> {
    await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}`,
      this.token,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ).catch(() => {});
  }

  async renameSession(sessionKey: string, name: string): Promise<{ ok: boolean }> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}/rename`,
        this.token,
        { method: 'POST', body: JSON.stringify({ name }) },
      );
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  }

  async deleteSession(sessionKey: string): Promise<{ ok: boolean }> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}`,
        this.token,
        { method: 'DELETE' },
      );
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as { deleted?: boolean };
      return { ok: json.deleted !== false };
    } catch {
      return { ok: false };
    }
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
