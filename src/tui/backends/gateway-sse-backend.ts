import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { parseModelRef } from '../../agent/models/selection.js';
import type { ExportFormat } from '../../session/types.js';
import type { TranscriptStoredRow } from '../../session/session-context-for-llm.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { createLogger } from '../../utils/logger.js';
import { consumeSSEStream, parseSSEData } from '../sse-consumer.js';
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
  TuiStartupResources,
  TuiTranscriptTreeEntry,
} from '../tui-backend.js';
import type { SessionInfo } from '../tui-types.js';
import { computeTuiSessionStats } from '../tui-session-stats.js';
import { buildTuiTranscriptTree, transcriptTreeEntryIdToRowNumber } from '../tui-transcript-tree.js';

const log = createLogger('TUI:GatewaySSE');

interface GatewaySSEOptions {
  url: string;
  token?: string;
}

function normalizeGatewayModelChoice(model: TuiModelChoice): TuiModelChoice {
  const providerPrefix = `${model.provider}/`;
  const id = model.id.startsWith(providerPrefix)
    ? model.id.slice(providerPrefix.length)
    : model.id;
  return { ...model, id };
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

  getActiveSignal(): AbortSignal | undefined {
    const signal = this.chatAbort?.signal;
    return signal && !signal.aborted ? signal : undefined;
  }

  // ── Agent chat (POST /api/agent → SSE response body) ──

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    const signal = this.chatAbort.signal;
    const runId = crypto.randomUUID();

    // Match EmbeddedBackend: set activeRunId before any message/tool events so TUI state stays on one
    // runId (avoids assistant under "default" and tools under the real uuid).
    this.onEvent?.({ event: 'agent_start', data: { runId }, source: 'agent-response' });

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
            attachments: opts.attachments,
            thinking: opts.thinking,
          }),
          signal,
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          this.onEvent?.({
            event: 'error',
            data: { content: body.error?.message ?? `Gateway error: ${res.status}` },
            source: 'agent-response',
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
              this.onEvent?.({ event: sseEvent.event, data, source: 'agent-response' });
            },
            signal,
          );
        } else {
          const json = (await res.json()) as { ok?: boolean; payload?: { content?: string } };
          if (json.ok && json.payload?.content) {
            this.onEvent?.({
              event: 'message_end',
              data: {
                runId,
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: json.payload.content }],
                  timestamp: Date.now(),
                },
              },
              source: 'agent-response',
            });
            this.onEvent?.({ event: 'agent_end', data: { runId }, source: 'agent-response' });
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.onEvent?.({ event: 'error', data: { runId, content: errorMessage }, source: 'agent-response' });
      }
    })();

    return { runId };
  }

  async resumeChat(opts: { sessionKey: string; runId: string }): Promise<{ ok: boolean; reason?: string }> {
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    const signal = this.chatAbort.signal;
    this.onEvent?.({
      event: 'agent_start',
      data: { runId: opts.runId },
      source: 'agent-resume',
    });

    let res: Response;
    try {
      res = await gatewayFetch(this.baseUrl, '/api/agent/resume', this.token, {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
        body: JSON.stringify({ runId: opts.runId, chatId: opts.sessionKey }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return { ok: false, reason: 'resume aborted' };
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: errorMessage };
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      return { ok: false, reason: body.error?.message ?? `Resume failed: ${res.status}` };
    }

    const contentType = res.headers.get('Content-Type') ?? '';
    if (!contentType.includes('text/event-stream') || !res.body) {
      return { ok: false, reason: 'Resume endpoint did not return an SSE stream' };
    }

    void (async () => {
      try {
        await consumeSSEStream(
          res.body,
          (sseEvent) => {
            if (signal.aborted) return;
            const data = parseSSEData<Record<string, unknown>>(sseEvent.data);
            if (!data) return;
            this.onEvent?.({ event: sseEvent.event, data, source: 'agent-resume' });
          },
          signal,
        );
      } catch (error) {
        if (signal.aborted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.onEvent?.({ event: 'error', data: { runId: opts.runId, content: errorMessage }, source: 'agent-resume' });
      }
    })();

    return { ok: true };
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

  async getStartupResources(sessionKey: string): Promise<TuiStartupResources> {
    const empty: TuiStartupResources = { context: [], skills: [], workflows: [], connectors: [] };
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/tui/startup-resources?sessionKey=${encodeURIComponent(sessionKey)}`,
        this.token,
      );
      if (!res.ok) return empty;
      const json = (await res.json()) as { payload?: Partial<TuiStartupResources> };
      return {
        context: Array.isArray(json.payload?.context) ? json.payload.context : [],
        skills: Array.isArray(json.payload?.skills) ? json.payload.skills : [],
        workflows: Array.isArray(json.payload?.workflows) ? json.payload.workflows : [],
        connectors: Array.isArray(json.payload?.connectors) ? json.payload.connectors : [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Failed to load startup resources: ${errorMessage}`);
      return empty;
    }
  }

  async loadHistory(opts: {
    sessionKey: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(opts.sessionKey)}?include=transcriptRows`,
        this.token,
      );
      if (!res.ok) return { messages: [] };
      const json = (await res.json()) as {
        session?: { transcriptRows?: unknown[] };
      };
      const rows = Array.isArray(json.session?.transcriptRows)
        ? (json.session.transcriptRows as TranscriptStoredRow[])
        : [];
      return { messages: transcriptRowsToClientHistory(rows, { limit: opts.limit }) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Failed to load history: ${errorMessage}`);
      return { messages: [] };
    }
  }

  async loadTranscriptTree(sessionKey: string): Promise<TuiTranscriptTreeEntry[]> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}?include=transcriptRows`,
        this.token,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as {
        session?: { transcriptRows?: unknown[] };
      };
      const rows = Array.isArray(json.session?.transcriptRows)
        ? (json.session.transcriptRows as TranscriptStoredRow[])
        : [];
      return buildTuiTranscriptTree(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Failed to load transcript tree: ${errorMessage}`);
      return [];
    }
  }

  async getSessionStats(sessionKey: string): Promise<TuiSessionStats> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}?include=transcriptRows`,
        this.token,
      );
      if (!res.ok) return computeTuiSessionStats([]);
      const json = (await res.json()) as {
        session?: { transcriptRows?: unknown[] };
      };
      const rows = Array.isArray(json.session?.transcriptRows)
        ? (json.session.transcriptRows as TranscriptStoredRow[])
        : [];
      return computeTuiSessionStats(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Failed to load session stats: ${errorMessage}`);
      return computeTuiSessionStats([]);
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
          cwd?: string;
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
        forkedFromSessionKey:
          typeof s.customData?.forkedFromSessionKey === 'string'
            ? s.customData.forkedFromSessionKey
            : undefined,
        cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
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
          payload?: {
            model?: string;
            thinkingLevel?: string;
            reasoningLevel?: string;
            verboseLevel?: string;
            effectiveWorkspacePath?: string;
            workingDirectoryLocked?: boolean;
          };
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
        if (p?.reasoningLevel && typeof p.reasoningLevel === 'string') {
          out.reasoningLevel = p.reasoningLevel;
        }
        if (p?.verboseLevel && typeof p.verboseLevel === 'string') {
          out.verboseLevel = p.verboseLevel;
        }
        if (p?.effectiveWorkspacePath && typeof p.effectiveWorkspacePath === 'string') {
          out.effectiveWorkspacePath = p.effectiveWorkspacePath;
        }
        if (typeof p?.workingDirectoryLocked === 'boolean') {
          out.workingDirectoryLocked = p.workingDirectoryLocked;
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
      return (json.payload?.models ?? []).map(normalizeGatewayModelChoice);
    } catch {
      return [];
    }
  }

  async resetSession(sessionKey: string): Promise<void> {
    await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/reset`,
      this.token,
      { method: 'POST' },
    ).catch(() => {});
  }

  async compactSession(
    sessionKey: string,
    options?: { force?: boolean; instructions?: string },
  ): Promise<TuiCompactionResult> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}/compaction/run`,
        this.token,
        {
          method: 'POST',
          body: JSON.stringify({
            force: options?.force ?? true,
            instructions: options?.instructions,
          }),
        },
      );
      if (!res.ok) {
        return { compacted: false, summary: `Compaction failed (${res.status})` };
      }
      const json = (await res.json()) as {
        ok?: boolean;
        payload?: {
          result?: {
            compacted?: boolean;
            summary?: string;
            tokensBefore?: number;
            tokensAfter?: number;
          };
        };
      };
      const result = json.payload?.result;
      if (!result?.compacted) {
        return { compacted: false, summary: 'Nothing to compact' };
      }
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
    const params = new URLSearchParams({ format });
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/export?${params.toString()}`,
      this.token,
    );
    if (!res.ok) {
      throw new Error(`Export failed (${res.status})`);
    }
    const json = (await res.json()) as { content?: string };
    return json.content ?? '';
  }

  async importSession(
    targetSessionKey: string,
    jsonContent: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    const res = await gatewayFetch(
      this.baseUrl,
      '/api/sessions/import',
      this.token,
      { method: 'POST', body: JSON.stringify({ targetKey: targetSessionKey, content: jsonContent }) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      sessionKey?: string;
      rowCount?: number;
    };
    if (!res.ok || json.ok === false || !json.sessionKey) {
      throw new Error(json.error ?? `Import failed (${res.status})`);
    }
    return { sessionKey: json.sessionKey, rowCount: json.rowCount ?? 0 };
  }

  async createShare(
    sessionKey: string,
    request: TuiShareRequest,
    options?: { agentId?: string },
  ): Promise<TuiShareResult> {
    const res = await gatewayFetch(this.baseUrl, '/api/shares/auto', this.token, {
      method: 'POST',
      body: JSON.stringify({
        path: request.path,
        audience: request.audience,
        mode: request.mode,
        title: request.title,
        description: request.description,
        sessionKey,
        agentId: options?.agentId,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: { message?: string };
      payload?: {
        share?: {
          kind?: string;
          title?: string;
          description?: string;
          shareUrl?: string;
          reachability?: string;
          reachabilityHint?: string | null;
          expiresAt?: string;
          maxViews?: number | null;
        };
        thumbnail?: { url?: string };
        routing?: { reason?: string; hint?: string };
      };
    };
    if (!res.ok || json.ok === false || !json.payload?.share?.shareUrl) {
      throw new Error(json.error?.message ?? `Share failed (${res.status})`);
    }
    const share = json.payload.share;
    return {
      kind: share.kind ?? 'share',
      shareUrl: share.shareUrl,
      title: share.title,
      description: share.description,
      thumbnailUrl: json.payload.thumbnail?.url,
      reachability: share.reachability,
      reachabilityHint: share.reachabilityHint,
      expiresAt: share.expiresAt,
      maxViews: share.maxViews,
      routingReason: json.payload.routing?.reason,
      routingHint: json.payload.routing?.hint,
    };
  }

  async btwQuery(sessionKey: string, question: string): Promise<{ text: string; error?: string }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/btw`,
      this.token,
      { method: 'POST', body: JSON.stringify({ question }) },
    );
    if (!res.ok) {
      return { text: '', error: `BTW failed (${res.status})` };
    }
    return (await res.json()) as { text: string; error?: string };
  }

  async forkSession(
    sourceSessionKey: string,
    targetSessionKey: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sourceSessionKey)}/fork`,
      this.token,
      { method: 'POST', body: JSON.stringify({ targetKey: targetSessionKey }) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      sessionKey?: string;
      rowCount?: number;
    };
    if (!res.ok || json.ok === false || !json.sessionKey) {
      throw new Error(json.error ?? `Fork failed (${res.status})`);
    }
    return { sessionKey: json.sessionKey, rowCount: json.rowCount ?? 0 };
  }

  async forkSessionAt(
    sourceSessionKey: string,
    targetSessionKey: string,
    entryId: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    const throughRow = transcriptTreeEntryIdToRowNumber(entryId);
    if (throughRow == null) {
      throw new Error(`Invalid transcript entry: ${entryId}`);
    }
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sourceSessionKey)}/fork-row`,
      this.token,
      { method: 'POST', body: JSON.stringify({ targetKey: targetSessionKey, throughRow }) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      sessionKey?: string;
      rowCount?: number;
    };
    if (!res.ok || json.ok === false || !json.sessionKey) {
      throw new Error(json.error ?? `Fork failed (${res.status})`);
    }
    return { sessionKey: json.sessionKey, rowCount: json.rowCount ?? 0 };
  }

  async setTranscriptLabel(
    sessionKey: string,
    entryId: string,
    label: string | undefined,
  ): Promise<{ ok: boolean }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/transcript/label`,
      this.token,
      { method: 'POST', body: JSON.stringify({ targetId: entryId, label }) },
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Label update failed (${res.status})`);
    }
    return { ok: true };
  }

  async appendCustomEntry(
    sessionKey: string,
    customType: string,
    data?: unknown,
  ): Promise<{ ok: boolean }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/transcript/custom`,
      this.token,
      { method: 'POST', body: JSON.stringify({ customType, data }) },
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Custom entry append failed (${res.status})`);
    }
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
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/transcript/custom-message`,
      this.token,
      { method: 'POST', body: JSON.stringify(message) },
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Custom message append failed (${res.status})`);
    }
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
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/transcript/bash`,
      this.token,
      { method: 'POST', body: JSON.stringify(entry) },
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Bash execution append failed (${res.status})`);
    }
    return { ok: true };
  }

  async patchSession(sessionKey: string, patch: Record<string, unknown>): Promise<void> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`,
      this.token,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Session config patch failed (${res.status})`);
    }
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
              this.onEvent?.({ event: sseEvent.event, data, source: 'broadcast' });
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
