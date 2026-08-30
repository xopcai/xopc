import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';
import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { parseModelRef } from '../../agent/models/selection.js';
import type { ExportFormat } from '../../session/types.js';
import type { TranscriptStoredRow } from '../../session/session-context-for-llm.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import type { SessionTimelineItem } from '../../session/transcript-outline.js';
import { createLogger } from '../../utils/logger.js';
import type {
  ChatSendOptions,
  HistoryMessage,
  TuiBackend,
  TuiCompactionResult,
  TuiChatInputState,
  TuiComposerHistoryItem,
  TuiEvent,
  TuiModelChoice,
  TuiShareRequest,
  TuiShareResult,
  TuiSessionStats,
  TuiSessionItem,
  TuiStartupResources,
  TuiTranscriptTreeEntry,
  TuiAgentInfo,
  TuiWorkspaceFileSearchEntry,
  TuiWorkflowRunStartRequest,
  TuiWorkflowRunStartResult,
  TuiStartupProjectResult,
} from '../tui-backend.js';
import type { SessionInfo } from '../tui-types.js';
import { computeTuiSessionStats } from '../tui-session-stats.js';
import { buildTuiTranscriptTree, transcriptTreeEntryIdToRowNumber } from '../tui-transcript-tree.js';
import type { ReviewContext } from '../../review/review-git.js';
import { gatewayCredentialAuthorization, type GatewayCredential } from '../../gateway/credential.js';

const log = createLogger('TUI:GatewayRealtime');
const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

interface GatewayRealtimeOptions {
  url: string;
  credential?: GatewayCredential;
}

function normalizeGatewayModelChoice(model: TuiModelChoice): TuiModelChoice {
  const providerPrefix = `${model.provider}/`;
  const id = model.id.startsWith(providerPrefix) ? model.id.slice(providerPrefix.length) : model.id;
  return { ...model, id };
}

/** Fetch wrapper that adds auth headers. */
async function gatewayFetch(
  baseUrl: string,
  path: string,
  credential: GatewayCredential | undefined,
  init?: RequestInit,
): Promise<Response> {
  const authorization = gatewayCredentialAuthorization(credential);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

/**
 * TUI backend that communicates with a running xopc gateway via REST + realtime WebSocket.
 *
 * - Agent input: durable session input REST plus replayable run topics
 * - Broadcast events: gateway realtime topic
 * - REST calls for sessions, models, etc.
 */
export class GatewayRealtimeBackend implements TuiBackend {
  private readonly baseUrl: string;
  private readonly credential: GatewayCredential | undefined;
  private readonly clientId = `tui-${crypto.randomUUID()}`;
  private realtime: RealtimeClient | null = null;
  private activeRunId: string | null = null;
  private observedSessionKey: string | null = null;
  private chatAbort: AbortController | null = null;

  onEvent?: (evt: TuiEvent) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onGap?: (info: { expected: number; received: number }) => void;

  constructor(opts: GatewayRealtimeOptions) {
    this.baseUrl = opts.url.replace(/\/+$/, '');
    this.credential = opts.credential;
  }

  get connectionLabel(): string {
    return this.baseUrl;
  }

  start(): void {
    this.startRealtime();
  }

  stop(): void {
    this.realtime?.disconnect();
    this.realtime = null;
    this.activeRunId = null;
    this.observedSessionKey = null;
    this.chatAbort?.abort();
    this.chatAbort = null;
  }

  getActiveSignal(): AbortSignal | undefined {
    const signal = this.chatAbort?.signal;
    return signal && !signal.aborted ? signal : undefined;
  }

  async getComposerInputHistory(): Promise<TuiComposerHistoryItem[]> {
    const res = await gatewayFetch(this.baseUrl, '/api/composer-history', this.credential);
    if (!res.ok) throw new Error(`Failed to load composer history (${res.status})`);
    const body = await res.json() as { items?: TuiComposerHistoryItem[] };
    return body.items ?? [];
  }

  async recordComposerInputHistory(text: string): Promise<TuiComposerHistoryItem> {
    const res = await gatewayFetch(this.baseUrl, '/api/composer-history', this.credential, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Failed to save composer history (${res.status})`);
    const body = await res.json() as { item: TuiComposerHistoryItem };
    return body.item;
  }

  // ── Agent chat ──

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    this.observedSessionKey = opts.sessionKey;
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    const signal = this.chatAbort.signal;
    const clientMessageId = crypto.randomUUID();
    const res = await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(opts.sessionKey)}/inputs`, this.credential, {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId, delivery: 'next',
        content: opts.message.trimStart().startsWith('/') ? opts.message : prependEnvelopeTimestamp(opts.message),
        attachments: opts.attachments, thinking: opts.thinking,
      }),
      signal,
    });
    const json = await res.json().catch(() => null) as {
      payload?: { state?: { activeRunId?: string; activeInputId?: string; inputs?: Array<{ id: string; clientMessageId: string }> } };
      error?: { message?: string };
    } | null;
    if (!res.ok) throw new Error(json?.error?.message ?? `Gateway error: ${res.status}`);
    const state = json?.payload?.state;
    const own = state?.inputs?.find((input) => input.clientMessageId === clientMessageId);
    const runId = state?.activeRunId ?? crypto.randomUUID();
    if (state?.activeRunId && own?.id === state.activeInputId) void this.resumeChat({ sessionKey: opts.sessionKey, runId });
    return { runId };
  }

  async searchWorkspaceFiles(
    sessionKey: string,
    query: string,
    options?: { limit?: number },
  ): Promise<TuiWorkspaceFileSearchEntry[]> {
    try {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('limit', String(options?.limit ?? 15));
      params.set('sessionKey', sessionKey);
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/workspace/editor/files/search?${params.toString()}`,
        this.credential,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as {
        ok?: boolean;
        payload?: { entries?: TuiWorkspaceFileSearchEntry[] };
      };
      return json.payload?.entries ?? [];
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err, sessionKey, errorMessage }, `Gateway workspace file search failed: ${errorMessage}`);
      return [];
    }
  }

  async getReviewContext(sessionKey: string): Promise<ReviewContext> {
    const params = new URLSearchParams({ sessionKey });
    const res = await gatewayFetch(this.baseUrl, `/api/review/context?${params.toString()}`, this.credential);
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      payload?: ReviewContext;
      error?: { message?: string };
    };
    if (!res.ok || !json.ok || !json.payload) {
      throw new Error(json.error?.message ?? `Review context failed (${res.status})`);
    }
    return json.payload;
  }

  async startWorkflowRun(opts: TuiWorkflowRunStartRequest): Promise<TuiWorkflowRunStartResult> {
    const goal = opts.goal?.trim();
    const res = await gatewayFetch(this.baseUrl, '/api/workflows/runs', this.credential, {
      method: 'POST',
      body: JSON.stringify({
        definitionId: opts.definitionId,
        agentId: opts.agentId,
        parentSessionKey: opts.sessionKey,
        source: { kind: 'chat', sessionKey: opts.sessionKey },
        ...(goal ? { goal } : {}),
        ...(opts.input !== undefined ? { input: opts.input } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      runId?: string;
      sessionKey?: string;
      error?: string;
      code?: string;
    };
    if (!res.ok || !json.runId || !json.sessionKey) {
      throw new Error(json.error ?? `Workflow start failed (${res.status})`);
    }
    return {
      runId: json.runId,
      sessionKey: json.sessionKey,
      definitionId: opts.definitionId,
    };
  }

  async resolveStartupProject(opts: {
    workspacePath: string;
    sessionKey: string;
    agentId: string;
    autoCreate?: boolean;
  }): Promise<TuiStartupProjectResult> {
    const res = await gatewayFetch(this.baseUrl, '/api/projects/resolve-workspace', this.credential, {
      method: 'POST',
      body: JSON.stringify(opts),
    });
    const json = (await res.json().catch(() => ({}))) as TuiStartupProjectResult & {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Project workspace resolve failed (${res.status})`);
    }
    return {
      project: json.project ?? null,
      created: json.created,
      reason: json.reason,
    };
  }

  async resumeChat(opts: { sessionKey: string; runId: string }): Promise<{ ok: boolean; reason?: string }> {
    this.observedSessionKey = opts.sessionKey;
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    this.unsubscribeActiveRun();
    this.activeRunId = opts.runId;
    this.realtime?.subscribe(`run:${opts.runId}`, 0);
    return { ok: true };
  }

  async abortChat(opts: { sessionKey: string; runId: string }): Promise<{ ok: boolean }> {
    this.chatAbort?.abort();
    this.chatAbort = null;
    this.unsubscribeActiveRun();
    try {
      const res = await gatewayFetch(this.baseUrl, '/api/agent/abort', this.credential, {
        method: 'POST',
        body: JSON.stringify({ runId: opts.runId }),
      });
      const json = (await res.json()) as { ok?: boolean };
      return { ok: json.ok ?? false };
    } catch {
      return { ok: false };
    }
  }

  async submitChatInput(opts: { sessionKey: string; message: string; delivery: 'next' | 'steer' }): Promise<{ ok: boolean; effectiveDelivery?: 'next' | 'steer' }> {
    this.observedSessionKey = opts.sessionKey;
    try {
      const res = await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(opts.sessionKey)}/inputs`, this.credential, {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId: crypto.randomUUID(),
          delivery: opts.delivery,
          content: opts.message,
        }),
      });
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as { ok?: boolean; payload?: { effectiveDelivery?: 'next' | 'steer' } };
      return { ok: json.ok === true, effectiveDelivery: json.payload?.effectiveDelivery };
    } catch {
      return { ok: false };
    }
  }

  async getChatInputState(sessionKey: string): Promise<TuiChatInputState> {
    const res = await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(sessionKey)}/input-state`, this.credential);
    if (!res.ok) throw new Error(`Input state failed (${res.status})`);
    const json = await res.json() as { payload: TuiChatInputState };
    return json.payload;
  }

  // ── REST helpers ──

  async getStartupResources(sessionKey: string): Promise<TuiStartupResources> {
    const empty: TuiStartupResources = {
      context: [],
      skills: [],
      workflows: [],
      connectors: [],
    };
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/tui/startup-resources?sessionKey=${encodeURIComponent(sessionKey)}`,
        this.credential,
      );
      if (!res.ok) return empty;
      const json = (await res.json()) as {
        payload?: Partial<TuiStartupResources>;
      };
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

  async loadHistory(opts: { sessionKey: string; limit?: number }): Promise<{ messages: HistoryMessage[] }> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(opts.sessionKey)}?include=transcriptRows`,
        this.credential,
      );
      if (!res.ok) return { messages: [] };
      const json = (await res.json()) as {
        session?: { transcriptRows?: unknown[] };
      };
      const rows = Array.isArray(json.session?.transcriptRows)
        ? (json.session.transcriptRows as TranscriptStoredRow[])
        : [];
      return {
        messages: transcriptRowsToClientHistory(rows, { limit: opts.limit }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Failed to load history: ${errorMessage}`);
      return { messages: [] };
    }
  }

  async loadHistoryWindow(opts: { sessionKey: string; rowNumber: number; before?: number; after?: number }) {
    const params = new URLSearchParams({
      rowNumber: String(opts.rowNumber),
      before: String(opts.before ?? 80),
      after: String(opts.after ?? 120),
    });
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(opts.sessionKey)}/transcript/window?${params.toString()}`,
        this.credential,
      );
      if (!res.ok) {
        return {
          messages: [],
          startRowNumber: 0,
          endRowNumber: 0,
          totalRows: 0,
        };
      }
      const json = (await res.json()) as {
        payload?: {
          messages?: unknown[];
          startRowNumber?: unknown;
          endRowNumber?: unknown;
          totalRows?: unknown;
        };
      };
      const payload = json.payload ?? {};
      return {
        messages: Array.isArray(payload.messages) ? (payload.messages as HistoryMessage[]) : [],
        startRowNumber: typeof payload.startRowNumber === 'number' ? payload.startRowNumber : 0,
        endRowNumber: typeof payload.endRowNumber === 'number' ? payload.endRowNumber : 0,
        totalRows: typeof payload.totalRows === 'number' ? payload.totalRows : 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn(
        {
          err: error,
          sessionKey: opts.sessionKey,
          rowNumber: opts.rowNumber,
          errorMessage,
        },
        `Failed to load history window: ${errorMessage}`,
      );
      return { messages: [], startRowNumber: 0, endRowNumber: 0, totalRows: 0 };
    }
  }

  async loadTranscriptTree(sessionKey: string): Promise<TuiTranscriptTreeEntry[]> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}?include=transcriptRows`,
        this.credential,
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

  async loadTimeline(sessionKey: string): Promise<SessionTimelineItem[]> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}/timeline`,
        this.credential,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { items?: unknown[] };
      return Array.isArray(json.items) ? (json.items as SessionTimelineItem[]) : [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, sessionKey, errorMessage }, `Failed to load timeline: ${errorMessage}`);
      return [];
    }
  }

  async getSessionStats(sessionKey: string): Promise<TuiSessionStats> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}?include=transcriptRows`,
        this.credential,
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
      const res = await gatewayFetch(this.baseUrl, '/api/sessions', this.credential);
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
          typeof s.customData?.forkedFromSessionKey === 'string' ? s.customData.forkedFromSessionKey : undefined,
        cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
      }));
    } catch {
      return [];
    }
  }

  async listAgents(): Promise<TuiAgentInfo[]> {
    const agents = new Map<string, TuiAgentInfo>();
    try {
      const res = await gatewayFetch(this.baseUrl, '/api/agents', this.credential);
      if (res.ok) {
        const json = (await res.json()) as {
          payload?: { agents?: Array<{ id?: unknown; name?: unknown }> };
        };
        for (const row of json.payload?.agents ?? []) {
          if (typeof row.id !== 'string' || !row.id.trim()) continue;
          const id = row.id.trim().toLowerCase();
          agents.set(id, {
            id,
            enabled: true,
            ...(typeof row.name === 'string' && row.name.trim() ? { displayName: row.name.trim() } : {}),
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Failed to load agents: ${errorMessage}`);
    }
    return [...agents.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async setTuiDefaultAgent(agentId: string): Promise<{ agentId: string }> {
    const target = agentId.trim().toLowerCase();
    const res = await gatewayFetch(this.baseUrl, '/api/config', this.credential, {
      method: 'PATCH',
      body: JSON.stringify({ tui: { defaultAgent: target } }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: { message?: string } | string;
      payload?: { config?: { tui?: { defaultAgent?: unknown } } };
    };
    if (!res.ok || json.ok === false) {
      const error = typeof json.error === 'string' ? json.error : json.error?.message;
      throw new Error(error ?? `TUI default agent update failed (${res.status})`);
    }
    const saved = json.payload?.config?.tui?.defaultAgent;
    return {
      agentId: typeof saved === 'string' && saved.trim() ? saved.trim().toLowerCase() : target,
    };
  }

  async getSessionInfo(sessionKey: string): Promise<SessionInfo> {
    const out: SessionInfo = {};
    try {
      const sessionPath = `/api/sessions/${encodeURIComponent(sessionKey)}`;
      const [sessionRes, agentCfgRes] = await Promise.all([
        gatewayFetch(this.baseUrl, sessionPath, this.credential),
        gatewayFetch(this.baseUrl, `${sessionPath}/agent-config`, this.credential),
      ]);

      type SessionRow = {
        name?: string;
        estimatedTokens?: number;
        customData?: Record<string, unknown>;
        projectId?: string;
      };
      let session: SessionRow | undefined;

      if (sessionRes.ok) {
        const json = (await sessionRes.json()) as { session?: SessionRow };
        session = json.session;
        if (session) {
          if (session.name) out.displayName = session.name;
          if (session.estimatedTokens != null) out.totalTokens = session.estimatedTokens;
          if (session.projectId?.trim()) out.projectId = session.projectId.trim();
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
        const ref = typeof cd.model === 'string' ? cd.model : typeof cd.modelRef === 'string' ? cd.modelRef : undefined;
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
          (m) => m.id === out.model && (!out.modelProvider || m.provider === out.modelProvider),
        );
        const contextWindow = match?.contextWindow ?? 128_000;
        out.contextWindow = contextWindow;
        out.contextUsagePercent =
          contextWindow > 0 ? Math.min(100, Math.round((out.totalTokens / contextWindow) * 100)) : null;
      }

      return out;
    } catch {
      return {};
    }
  }

  async listModels(): Promise<TuiModelChoice[]> {
    try {
      const res = await gatewayFetch(this.baseUrl, '/api/models', this.credential);
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
    await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(sessionKey)}/reset`, this.credential, {
      method: 'POST',
    }).catch(() => {});
  }

  async compactSession(
    sessionKey: string,
    options?: { force?: boolean; instructions?: string },
  ): Promise<TuiCompactionResult> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}/compaction/run`,
        this.credential,
        {
          method: 'POST',
          body: JSON.stringify({
            force: options?.force ?? true,
            instructions: options?.instructions,
          }),
        },
      );
      if (!res.ok) {
        return {
          compacted: false,
          summary: `Compaction failed (${res.status})`,
        };
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
      this.credential,
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
    const res = await gatewayFetch(this.baseUrl, '/api/sessions/import', this.credential, {
      method: 'POST',
      body: JSON.stringify({
        targetKey: targetSessionKey,
        content: jsonContent,
      }),
    });
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
    const res = await gatewayFetch(this.baseUrl, '/api/shares/auto', this.credential, {
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
      this.credential,
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
      this.credential,
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
      this.credential,
      {
        method: 'POST',
        body: JSON.stringify({ targetKey: targetSessionKey, throughRow }),
      },
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

  async setTranscriptLabel(sessionKey: string, entryId: string, label: string | undefined): Promise<{ ok: boolean }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/transcript/label`,
      this.credential,
      { method: 'POST', body: JSON.stringify({ targetId: entryId, label }) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Label update failed (${res.status})`);
    }
    return { ok: true };
  }

  async appendCustomEntry(sessionKey: string, customType: string, data?: unknown): Promise<{ ok: boolean }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/transcript/custom`,
      this.credential,
      { method: 'POST', body: JSON.stringify({ customType, data }) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
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
      this.credential,
      { method: 'POST', body: JSON.stringify(message) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
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
      this.credential,
      { method: 'POST', body: JSON.stringify(entry) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Bash execution append failed (${res.status})`);
    }
    return { ok: true };
  }

  async patchSession(sessionKey: string, patch: Record<string, unknown>): Promise<void> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`,
      this.credential,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `Session config patch failed (${res.status})`);
    }
    const hasProjectPatch = Object.prototype.hasOwnProperty.call(patch, 'projectId');
    const projectId = typeof patch.projectId === 'string' ? patch.projectId.trim() : '';
    const hiddenFromSessionList = typeof patch.hiddenFromSessionList === 'boolean'
      ? patch.hiddenFromSessionList
      : undefined;
    const customData = patch.customData && typeof patch.customData === 'object' && !Array.isArray(patch.customData)
      ? patch.customData as Record<string, unknown>
      : undefined;
    if (hasProjectPatch || hiddenFromSessionList !== undefined || customData !== undefined) {
      const metadataPatch = {
        ...(hasProjectPatch ? { projectId: projectId || null } : {}),
        ...(hiddenFromSessionList !== undefined ? { hiddenFromSessionList } : {}),
        ...(customData ? { customData } : {}),
      };
      const metaRes = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}`,
        this.credential,
        { method: 'PATCH', body: JSON.stringify(metadataPatch) },
      );
      const metaJson = (await metaRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!metaRes.ok || metaJson.ok === false) {
        throw new Error(metaJson.error ?? `Session metadata patch failed (${metaRes.status})`);
      }
    }
  }

  async renameSession(sessionKey: string, name: string): Promise<{ ok: boolean }> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(sessionKey)}/rename`,
        this.credential,
        { method: 'POST', body: JSON.stringify({ name }) },
      );
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  }

  async deleteSession(sessionKey: string): Promise<{ ok: boolean }> {
    try {
      const res = await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(sessionKey)}`, this.credential, {
        method: 'DELETE',
      });
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as { deleted?: boolean };
      return { ok: json.deleted !== false };
    } catch {
      return { ok: false };
    }
  }

  private startRealtime(): void {
    this.realtime?.disconnect();
    this.realtime = new RealtimeClient({
      clientId: this.clientId,
      clientKind: 'tui',
      getWebSocketUrl: () => {
        const url = new URL(this.baseUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/api/realtime/v1/ws';
        url.search = '';
        url.hash = '';
        return url.toString();
      },
      issueTicket: async () => {
        const response = await gatewayFetch(this.baseUrl, '/api/realtime/tickets', this.credential, {
          method: 'POST',
          body: JSON.stringify({ clientId: this.clientId, clientKind: 'tui' }),
        });
        const body = await response.json().catch(() => null) as {
          payload?: { ticket?: string };
          error?: { message?: string };
        } | null;
        if (!response.ok || !body?.payload?.ticket) {
          throw new Error(body?.error?.message ?? `Realtime ticket failed (${response.status})`);
        }
        return body.payload.ticket;
      },
      createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
      onStateChange: (state, error) => {
        if (state === 'connected') this.onConnected?.();
        else if (state === 'error') this.onDisconnected?.(error ?? 'Realtime connection failed');
      },
      onEvent: (event) => this.handleRealtimeEvent(event),
      onGap: (gap) => {
        this.onGap?.({ expected: gap.requestedSeq + 1, received: gap.earliestSeq });
        if (gap.topic === `run:${this.activeRunId}`) {
          const runId = this.activeRunId;
          this.unsubscribeActiveRun();
          this.onEvent?.({
            event: 'error',
            data: {
              type: 'error',
              runId,
              timestamp: Date.now(),
              payload: { code: 'REALTIME_GAP', message: 'Run replay is no longer available' },
            },
            source: 'realtime-run',
          });
        }
      },
    });
    this.realtime.subscribe('gateway');
    this.realtime.subscribe('sessions');
    this.realtime.connect();
  }

  private handleRealtimeEvent(event: RealtimeEventPayload): void {
    if (event.topic === `run:${this.activeRunId}`) {
      const data = event.data && typeof event.data === 'object'
        ? { ...(event.data as Record<string, unknown>), seq: event.seq }
        : event.data;
      this.onEvent?.({ event: event.event, data, source: 'realtime-run' });
      if (event.event === 'run_end' || event.event === 'error') this.unsubscribeActiveRun();
      return;
    }
    if (event.topic === 'gateway') {
      this.onEvent?.({ event: event.event, data: event.data, source: 'realtime' });
      return;
    }
    if (event.topic === 'sessions' && event.event === 'run.started') {
      const data = event.data as { sessionKey?: unknown; runId?: unknown } | null;
      if (
        typeof data?.sessionKey === 'string'
        && data.sessionKey === this.observedSessionKey
        && typeof data.runId === 'string'
        && data.runId
        && data.runId !== this.activeRunId
      ) {
        void this.resumeChat({ sessionKey: data.sessionKey, runId: data.runId });
      }
    }
  }

  private unsubscribeActiveRun(): void {
    if (this.activeRunId) this.realtime?.unsubscribe(`run:${this.activeRunId}`);
    this.activeRunId = null;
  }
}
