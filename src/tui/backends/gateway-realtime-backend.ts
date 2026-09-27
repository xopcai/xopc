import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveStateDir } from '../../config/paths.js';

import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION, type RealtimeEventPayload } from '@xopcai/realtime-protocol';
import { isSessionCommandRejected, sessionInputCommandSchema, type SessionCreation, type SessionInputCommand } from '@xopcai/gateway-contract';

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
  private observedConversationId: string | null = null;
  private chatAbort: AbortController | null = null;
  private readonly drafts = new Map<string, SessionCreation>();
  private readonly pendingInputs = new Map<string, SessionInputCommand>();
  private draftDirectory?: string;
  private draftInitialization?: Promise<void>;

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
  async getComposerDraftDirectory(): Promise<string> {
    await this.initializeDrafts();
    return join(this.draftDirectory!, 'composers');
  }

  private initializeDrafts(): Promise<void> {
    return this.draftInitialization ??= (async () => {
      const response = await gatewayFetch(this.baseUrl, '/api/browser-session', this.credential);
      if (!response.ok) throw new Error('Gateway identity is unavailable');
      const identity = await response.json() as { conversationId: string };
      if (!identity.conversationId) throw new Error('Gateway identity is missing');
      const directory = join(resolveStateDir(), 'client-drafts', crypto.createHash('sha256').update(identity.conversationId).digest('hex'));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const file of await readdir(directory)) {
        if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue;
        const saved = JSON.parse(await readFile(join(directory, file), 'utf8')) as { creation?: SessionCreation; command?: SessionInputCommand };
        const id = file.slice(0, -5);
        if (saved.creation) this.drafts.set(id, saved.creation);
        if (saved.command) this.pendingInputs.set(id, sessionInputCommandSchema.parse(saved.command));
      }
      this.draftDirectory = directory;
    })().catch(error => { this.draftInitialization = undefined; throw error; });
  }

  private async persistDraft(conversationId: string): Promise<void> {
    if (!this.draftDirectory || !/^[0-9a-f-]{36}$/.test(conversationId)) throw new Error('Local conversation storage is unavailable');
    const path = join(this.draftDirectory, `${conversationId}.json`);
    const creation = this.drafts.get(conversationId);
    const command = this.pendingInputs.get(conversationId);
    if (!creation && !command) {
      await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      return;
    }
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ creation, command }), { mode: 0o600 });
    await rename(temporary, path);
  }

  start(): void {
    this.startRealtime();
  }

  stop(): void {
    this.realtime?.disconnect();
    this.realtime = null;
    this.activeRunId = null;
    this.observedConversationId = null;
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

  private async acceptReceipt(conversationId: string, command: SessionInputCommand, raw: unknown): Promise<void> {
    const payload = (raw as { payload?: { receipt?: { conversationId?: string; clientMessageId?: string }; session?: { transcriptId?: string } } })?.payload;
    if (payload?.receipt?.conversationId !== conversationId || payload.receipt.clientMessageId !== command.clientMessageId || !payload.session?.transcriptId) {
      throw new Error('Invalid input receipt; pending input retained');
    }
    this.drafts.delete(conversationId);
    this.pendingInputs.delete(conversationId);
    await this.persistDraft(conversationId);
  }

  private async reconcileInput(conversationId: string): Promise<void> {
    const pending = this.pendingInputs.get(conversationId);
    if (!pending) return;
    const response = await gatewayFetch(this.baseUrl,
      `/api/sessions/${encodeURIComponent(conversationId)}/input-receipts/${encodeURIComponent(pending.clientMessageId)}`, this.credential);
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Input confirmation failed (${response.status})`);
    await this.acceptReceipt(conversationId, pending, await response.json());
  }

  private async prepareInput(conversationId: string, clientMessageId: string, content: string,
    delivery: 'next' | 'steer', attachments?: ChatSendOptions['attachments']): Promise<SessionInputCommand> {
    const pending = this.pendingInputs.get(conversationId);
    if (pending) {
      if (pending.input.content !== content || JSON.stringify(pending.input.attachments) !== JSON.stringify(attachments)) {
        throw new Error('Previous input is awaiting confirmation; retry it before sending different content');
      }
      return pending;
    }
    const creation = this.drafts.get(conversationId);
    const input = { content, ...(attachments?.length ? { attachments } : {}) };
    const origin = { type: 'system' as const, source: 'cli' as const };
    let command: SessionInputCommand;
    if (creation) {
      if (!creation.model) {
        const response = await gatewayFetch(this.baseUrl, `/api/models?agentId=${encodeURIComponent(creation.agentId)}`, this.credential);
        if (!response.ok) throw new Error('Agent model configuration is unavailable');
        const { payload } = await response.json() as { payload: { defaultId?: string; models: Array<{ id: string; provider: string; thinking?: { initialValue: string } }> } };
        const model = payload.models.find(item => item.id === payload.defaultId);
        if (!model) throw new Error('Configure a model before sending');
        creation.model = model.id;
        creation.thinkingLevel = model.thinking?.initialValue ?? 'off';
      }
      command = sessionInputCommandSchema.parse({ kind: 'start', clientMessageId, creation, input, origin });
    } else {
      const path = `/api/sessions/${encodeURIComponent(conversationId)}`;
      const [detailResponse, configResponse] = await Promise.all([
        gatewayFetch(this.baseUrl, path, this.credential), gatewayFetch(this.baseUrl, `${path}/agent-config`, this.credential),
      ]);
      if (!detailResponse.ok || !configResponse.ok) throw new Error('Session identity is unavailable');
      const detail = await detailResponse.json() as { session: { transcriptId: string } };
      const config = await configResponse.json() as { payload: { configVersion: number } };
      command = sessionInputCommandSchema.parse({ kind: 'append', clientMessageId,
        expectedTranscriptId: detail.session.transcriptId, configVersion: config.payload.configVersion, delivery, input, origin });
    }
    this.pendingInputs.set(conversationId, command);
    await this.persistDraft(conversationId);
    return command;
  }

  async sendChat(opts: ChatSendOptions): Promise<{ runId: string }> {
    this.observedConversationId = opts.conversationId;
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    const signal = this.chatAbort.signal;
    const clientMessageId = crypto.randomUUID();
    const command = await this.prepareInput(opts.conversationId, clientMessageId,
      opts.message, 'next', opts.attachments);
    const res = await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(opts.conversationId)}/inputs`, this.credential, {
      method: 'POST',
      body: JSON.stringify(command),
      signal,
    });
    const json = await res.json().catch(() => null) as {
      payload?: { inputState?: { activeRunId?: string; activeInputId?: string; inputs?: Array<{ id: string; clientMessageId: string }> } };
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      if (isSessionCommandRejected(res.status, json)) {
        this.pendingInputs.delete(opts.conversationId);
        await this.persistDraft(opts.conversationId);
      }
      throw new Error(json?.error?.message ?? `Gateway error: ${res.status}`);
    }
    await this.acceptReceipt(opts.conversationId, command, json);
    const state = json?.payload?.inputState;
    const own = state?.inputs?.find((input) => input.clientMessageId === command.clientMessageId);
    const runId = state?.activeRunId ?? crypto.randomUUID();
    if (state?.activeRunId && own?.id === state.activeInputId) void this.resumeChat({ conversationId: opts.conversationId, runId });
    return { runId };
  }

  async searchWorkspaceFiles(
    conversationId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<TuiWorkspaceFileSearchEntry[]> {
    try {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('limit', String(options?.limit ?? 15));
      const context = await gatewayFetch(
        this.baseUrl,
        this.drafts.has(conversationId)
          ? `/api/files/contexts/${this.drafts.get(conversationId)!.projectId ? 'project' : 'agent'}/${encodeURIComponent(this.drafts.get(conversationId)!.projectId || this.drafts.get(conversationId)!.agentId)}`
          : `/api/files/contexts/session/${encodeURIComponent(conversationId)}`,
        this.credential,
      );
      if (!context.ok) return [];
      const contextJson = await context.json() as { space?: { id?: string } };
      if (!contextJson.space?.id) return [];
      params.set('spaceId', contextJson.space.id);
      const res = await gatewayFetch(this.baseUrl, `/api/files/search?${params.toString()}`, this.credential);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        items?: Array<{ name: string; relativePath: string; kind: 'file' | 'directory' }>;
      };
      return (json.items ?? []).map((item) => ({
        name: item.name,
        path: item.relativePath,
        isDirectory: item.kind === 'directory',
      } satisfies TuiWorkspaceFileSearchEntry));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err, conversationId, errorMessage }, `Gateway workspace file search failed: ${errorMessage}`);
      return [];
    }
  }

  async getReviewContext(conversationId: string): Promise<ReviewContext> {
    const draft = this.drafts.get(conversationId);
    const params = new URLSearchParams(draft
      ? { agentId: draft.agentId, ...(draft.projectId ? { projectId: draft.projectId } : {}) }
      : { conversationId });
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
        parentConversationId: opts.conversationId,
        source: { kind: 'chat', conversationId: opts.conversationId },
        ...(goal ? { goal } : {}),
        ...(opts.input !== undefined ? { input: opts.input } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      runId?: string;
      conversationId?: string;
      error?: string;
      code?: string;
    };
    if (!res.ok || !json.runId || !json.conversationId) {
      throw new Error(json.error ?? `Workflow start failed (${res.status})`);
    }
    return {
      runId: json.runId,
      conversationId: json.conversationId,
      definitionId: opts.definitionId,
    };
  }

  async resolveStartupProject(opts: {
    workspacePath: string;
    conversationId: string;
    agentId: string;
    autoCreate?: boolean;
  }): Promise<TuiStartupProjectResult> {
    const res = await gatewayFetch(this.baseUrl, '/api/projects/resolve-workspace', this.credential, {
      method: 'POST',
      body: JSON.stringify({ ...opts, ...(this.drafts.has(opts.conversationId) ? { conversationId: undefined } : {}) }),
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

  async resumeChat(opts: { conversationId: string; runId: string }): Promise<{ ok: boolean; reason?: string }> {
    this.observedConversationId = opts.conversationId;
    this.chatAbort?.abort();
    this.chatAbort = new AbortController();
    this.unsubscribeActiveRun();
    this.activeRunId = opts.runId;
    this.realtime?.subscribe(`run:${opts.runId}`, 0);
    return { ok: true };
  }

  async abortChat(opts: { conversationId: string; runId: string }): Promise<{ ok: boolean }> {
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

  async submitChatInput(opts: { conversationId: string; message: string; delivery: 'next' | 'steer' }): Promise<{
    ok: boolean;
    effectiveDelivery?: 'next' | 'steer';
    state?: TuiChatInputState;
  }> {
    this.observedConversationId = opts.conversationId;
    try {
      const command = await this.prepareInput(opts.conversationId, crypto.randomUUID(), opts.message, opts.delivery);
      const res = await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(opts.conversationId)}/inputs`, this.credential, {
        method: 'POST',
        body: JSON.stringify(command),
      });
      if (!res.ok) {
        if (isSessionCommandRejected(res.status, await res.json().catch(() => null))) {
          this.pendingInputs.delete(opts.conversationId);
          await this.persistDraft(opts.conversationId);
        }
        return { ok: false };
      }
      const json = (await res.json()) as {
        ok?: boolean;
        payload?: { effectiveDelivery?: 'next' | 'steer'; inputState?: TuiChatInputState };
      };
      await this.acceptReceipt(opts.conversationId, command, json);
      return {
        ok: json.ok === true,
        effectiveDelivery: json.payload?.effectiveDelivery,
        state: json.payload?.inputState,
      };
    } catch {
      return { ok: false };
    }
  }

  async getChatInputState(conversationId: string): Promise<TuiChatInputState> {
    if (this.drafts.has(conversationId)) return { conversationId, revision: 0, inputs: [] };
    const res = await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(conversationId)}/input-state`, this.credential);
    if (!res.ok) throw new Error(`Input state failed (${res.status})`);
    const json = await res.json() as { payload: TuiChatInputState };
    return json.payload;
  }

  async updateChatInput(opts: {
    conversationId: string;
    inputId: string;
    version: number;
    content: string;
  }): Promise<{ ok: boolean; state?: TuiChatInputState }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(opts.conversationId)}/inputs/${encodeURIComponent(opts.inputId)}`,
      this.credential,
      { method: 'PATCH', body: JSON.stringify({ version: opts.version, content: opts.content }) },
    );
    const json = await res.json().catch(() => ({})) as { ok?: boolean; payload?: TuiChatInputState };
    return { ok: res.ok && json.ok === true, state: json.payload };
  }

  async removeChatInput(opts: {
    conversationId: string;
    inputId: string;
    version: number;
  }): Promise<{ ok: boolean; state?: TuiChatInputState }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(opts.conversationId)}/inputs/${encodeURIComponent(opts.inputId)}?version=${opts.version}`,
      this.credential,
      { method: 'DELETE' },
    );
    const json = await res.json().catch(() => ({})) as { ok?: boolean; payload?: TuiChatInputState };
    return { ok: res.ok && json.ok === true, state: json.payload };
  }

  // ── REST helpers ──

  async getStartupResources(conversationId: string): Promise<TuiStartupResources> {
    const empty: TuiStartupResources = {
      context: [],
      skills: [],
      workflows: [],
      connectors: [],
    };
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/tui/startup-resources?${this.drafts.has(conversationId) ? `agentId=${encodeURIComponent(this.drafts.get(conversationId)!.agentId)}` : `conversationId=${encodeURIComponent(conversationId)}`}`,
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
      log.warn({ err: error, conversationId, errorMessage }, `Failed to load startup resources: ${errorMessage}`);
      return empty;
    }
  }

  async loadHistory(opts: { conversationId: string; limit?: number }): Promise<{ messages: HistoryMessage[] }> {
    await this.reconcileInput(opts.conversationId);
    if (this.drafts.has(opts.conversationId)) return { messages: [] };
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(opts.conversationId)}?include=transcriptRows`,
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

  async loadHistoryWindow(opts: { conversationId: string; rowNumber: number; before?: number; after?: number }) {
    const params = new URLSearchParams({
      rowNumber: String(opts.rowNumber),
      before: String(opts.before ?? 80),
      after: String(opts.after ?? 120),
    });
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(opts.conversationId)}/transcript/window?${params.toString()}`,
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
          conversationId: opts.conversationId,
          rowNumber: opts.rowNumber,
          errorMessage,
        },
        `Failed to load history window: ${errorMessage}`,
      );
      return { messages: [], startRowNumber: 0, endRowNumber: 0, totalRows: 0 };
    }
  }

  async loadTranscriptTree(conversationId: string): Promise<TuiTranscriptTreeEntry[]> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(conversationId)}?include=transcriptRows`,
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
      log.warn({ err: error, conversationId, errorMessage }, `Failed to load transcript tree: ${errorMessage}`);
      return [];
    }
  }

  async loadTimeline(conversationId: string): Promise<SessionTimelineItem[]> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(conversationId)}/timeline`,
        this.credential,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { items?: unknown[] };
      return Array.isArray(json.items) ? (json.items as SessionTimelineItem[]) : [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, conversationId, errorMessage }, `Failed to load timeline: ${errorMessage}`);
      return [];
    }
  }

  async getSessionStats(conversationId: string): Promise<TuiSessionStats> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(conversationId)}?include=transcriptRows`,
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
      log.warn({ err: error, conversationId, errorMessage }, `Failed to load session stats: ${errorMessage}`);
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
          agentId: string;
          sourceChannel?: string;
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
        agentId: s.agentId,
        sourceChannel: s.sourceChannel,
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
        forkedFromConversationId:
          typeof s.customData?.forkedFromConversationId === 'string' ? s.customData.forkedFromConversationId : undefined,
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

  async createConversation(agentId: string, conversationId?: string): Promise<string> {
    const id = conversationId ?? crypto.randomUUID();
    this.drafts.set(id, { agentId, projectId: null, execution: null, temporary: false, model: '', thinkingLevel: 'off' });
    await this.persistDraft(id);
    return id;
  }

  async getSessionInfo(conversationId: string): Promise<SessionInfo> {
    await this.reconcileInput(conversationId);
    const draft = this.drafts.get(conversationId);
    if (draft) return { agentId: draft.agentId, model: draft.model, thinkingLevel: draft.thinkingLevel, projectId: draft.projectId ?? undefined };
    const out: SessionInfo = {};
    try {
      const sessionPath = `/api/sessions/${encodeURIComponent(conversationId)}`;
      const [sessionRes, agentCfgRes] = await Promise.all([
        gatewayFetch(this.baseUrl, sessionPath, this.credential),
        gatewayFetch(this.baseUrl, `${sessionPath}/agent-config`, this.credential),
      ]);

      type SessionRow = {
        agentId: string;
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
          out.agentId = session.agentId;
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

  async resetSession(conversationId: string): Promise<void> {
    await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(conversationId)}/reset`, this.credential, {
      method: 'POST',
    }).catch(() => {});
  }

  async compactSession(
    conversationId: string,
    options?: { force?: boolean; instructions?: string },
  ): Promise<TuiCompactionResult> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(conversationId)}/compaction/run`,
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

  async exportSession(conversationId: string, format: ExportFormat): Promise<string> {
    const params = new URLSearchParams({ format });
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(conversationId)}/export?${params.toString()}`,
      this.credential,
    );
    if (!res.ok) {
      throw new Error(`Export failed (${res.status})`);
    }
    const json = (await res.json()) as { content?: string };
    return json.content ?? '';
  }

  async importSession(
    targetConversationId: string,
    jsonContent: string,
  ): Promise<{ conversationId: string; rowCount: number }> {
    const res = await gatewayFetch(this.baseUrl, '/api/sessions/import', this.credential, {
      method: 'POST',
      body: JSON.stringify({
        targetKey: targetConversationId,
        content: jsonContent,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      conversationId?: string;
      rowCount?: number;
    };
    if (!res.ok || json.ok === false || !json.conversationId) {
      throw new Error(json.error ?? `Import failed (${res.status})`);
    }
    return { conversationId: json.conversationId, rowCount: json.rowCount ?? 0 };
  }

  async createShare(
    conversationId: string,
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
        conversationId,
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

  async btwQuery(conversationId: string, question: string): Promise<{ text: string; error?: string }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(conversationId)}/btw`,
      this.credential,
      { method: 'POST', body: JSON.stringify({ question }) },
    );
    if (!res.ok) {
      return { text: '', error: `BTW failed (${res.status})` };
    }
    return (await res.json()) as { text: string; error?: string };
  }

  async forkSession(
    sourceConversationId: string,
    targetConversationId: string,
  ): Promise<{ conversationId: string; rowCount: number }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sourceConversationId)}/fork`,
      this.credential,
      { method: 'POST', body: JSON.stringify({ targetKey: targetConversationId }) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      conversationId?: string;
      rowCount?: number;
    };
    if (!res.ok || json.ok === false || !json.conversationId) {
      throw new Error(json.error ?? `Fork failed (${res.status})`);
    }
    return { conversationId: json.conversationId, rowCount: json.rowCount ?? 0 };
  }

  async forkSessionAt(
    sourceConversationId: string,
    targetConversationId: string,
    entryId: string,
  ): Promise<{ conversationId: string; rowCount: number }> {
    const throughRow = transcriptTreeEntryIdToRowNumber(entryId);
    if (throughRow == null) {
      throw new Error(`Invalid transcript entry: ${entryId}`);
    }
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(sourceConversationId)}/fork-row`,
      this.credential,
      {
        method: 'POST',
        body: JSON.stringify({ targetKey: targetConversationId, throughRow }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      conversationId?: string;
      rowCount?: number;
    };
    if (!res.ok || json.ok === false || !json.conversationId) {
      throw new Error(json.error ?? `Fork failed (${res.status})`);
    }
    return { conversationId: json.conversationId, rowCount: json.rowCount ?? 0 };
  }

  async setTranscriptLabel(conversationId: string, entryId: string, label: string | undefined): Promise<{ ok: boolean }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(conversationId)}/transcript/label`,
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

  async appendCustomEntry(conversationId: string, customType: string, data?: unknown): Promise<{ ok: boolean }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(conversationId)}/transcript/custom`,
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
    conversationId: string,
    message: {
      customType: string;
      content?: string | unknown[];
      display?: boolean;
      details?: unknown;
    },
  ): Promise<{ ok: boolean }> {
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(conversationId)}/transcript/custom-message`,
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
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(conversationId)}/transcript/bash`,
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

  async patchSession(conversationId: string, patch: Record<string, unknown>): Promise<void> {
    const draft = this.drafts.get(conversationId);
    if (draft) {
      if (this.pendingInputs.has(conversationId)) throw new Error('First input is awaiting confirmation');
      if (typeof patch.workingDirectory === 'string') {
        const resolved = await this.resolveStartupProject({ workspacePath: patch.workingDirectory,
          conversationId, agentId: draft.agentId, autoCreate: true });
        if (!resolved.project) throw new Error('Working directory could not be bound to a project');
        draft.projectId = resolved.project.id;
        draft.execution = { mode: 'local_checkout' };
      }
      if (typeof patch.model === 'string') draft.model = patch.model;
      if (typeof patch.thinkingLevel === 'string') draft.thinkingLevel = patch.thinkingLevel;
      if (typeof patch.projectId === 'string') {
        draft.projectId = patch.projectId;
        draft.execution = { mode: 'local_checkout' };
      }
      if (patch.projectId === null) { draft.projectId = null; draft.execution = null; }
      await this.persistDraft(conversationId);
      return;
    }
    const res = await gatewayFetch(
      this.baseUrl,
      `/api/sessions/${encodeURIComponent(conversationId)}/agent-config`,
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
        `/api/sessions/${encodeURIComponent(conversationId)}`,
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

  async renameSession(conversationId: string, name: string): Promise<{ ok: boolean }> {
    try {
      const res = await gatewayFetch(
        this.baseUrl,
        `/api/sessions/${encodeURIComponent(conversationId)}/rename`,
        this.credential,
        { method: 'POST', body: JSON.stringify({ name }) },
      );
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  }

  async deleteSession(conversationId: string): Promise<{ ok: boolean }> {
    try {
      const res = await gatewayFetch(this.baseUrl, `/api/sessions/${encodeURIComponent(conversationId)}`, this.credential, {
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
        await this.initializeDrafts();
        const response = await gatewayFetch(this.baseUrl, '/api/realtime/tickets', this.credential, {
          method: 'POST',
          body: JSON.stringify({ clientId: this.clientId, clientKind: 'tui', protocolVersion: REALTIME_PROTOCOL_VERSION }),
        });
        const body = await response.json().catch(() => null) as {
          payload?: { ticket?: string; realtime?: { minVersion: number; maxVersion: number; capabilities: string[] } };
          error?: { message?: string };
        } | null;
        if (!response.ok || !body?.payload?.ticket || !body.payload.realtime) {
          throw new Error(body?.error?.message ?? `Realtime ticket failed (${response.status})`);
        }
        return { ticket: body.payload.ticket, realtime: body.payload.realtime };
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
      const data = event.data as { conversationId?: unknown; runId?: unknown } | null;
      if (
        typeof data?.conversationId === 'string'
        && data.conversationId === this.observedConversationId
        && typeof data.runId === 'string'
        && data.runId
        && data.runId !== this.activeRunId
      ) {
        void this.resumeChat({ conversationId: data.conversationId, runId: data.runId });
      }
    }
  }

  private unsubscribeActiveRun(): void {
    if (this.activeRunId) this.realtime?.unsubscribe(`run:${this.activeRunId}`);
    this.activeRunId = null;
  }
}
