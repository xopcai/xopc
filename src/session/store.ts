import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../config/schema.js';
import { resolveStateDir } from '../config/paths-state.js';
import { resolveEffectiveAgentProfileForSession } from '../config/agent-profile.js';
import { readPostCompactionContext } from '../agent/reply/post-compaction-context.js';
import { createLogger } from '../utils/logger.js';
import { SessionCompactor, type CompactionConfig, type CompactionResult } from '../agent/memory/compaction.js';
import { SlidingWindow, type WindowConfig } from '../agent/memory/window.js';
import {
  isXopcDatabaseOpen,
  openXopcDatabase,
  appendTranscriptEntry,
  captureCompactionCheckpoint,
  deleteSessionRecord,
  ensureSessionRecord,
  estimateTokensFromMessages,
  getCompactionCheckpointDetail,
  getCurrentTranscriptId,
  getGlobalSessionStats,
  getSessionMetadata,
  listCompactionCheckpoints,
  listSessionMetadata,
  listSessionsByAgent,
  loadCheckpointRows,
  loadLlmMessagesForSession,
  loadTranscriptRowsForSession,
  patchSessionMetadata,
  replaceTranscriptRows,
  resetSessionRecord,
  restoreCompactionCheckpoint,
} from '../storage/sqlite/index.js';
import type { TranscriptCompactionRecord, XopcSessionTranscriptV1 } from './transcript-format.js';
import {
  buildSessionContextForLlm,
  mergeLlmMessagesPreservingContextRows,
  type TranscriptStoredRow,
  type XopcTranscriptContextEntry,
} from './session-context-for-llm.js';
import { normalizeCompactionCheckpointId } from './compaction-checkpoints.js';
import type {
  SessionMetadata,
  SessionDetail,
  SessionListQuery,
  PaginatedResult,
  GlobalSessionStats,
  ExportFormat,
  SessionExport,
  SessionTranscriptSummary,
  CompactionCheckpointSummary,
  CompactionCheckpointDetail,
} from './types.js';
import { SessionStatus } from './types.js';
import type { Message } from './types.js';
import type { SessionTranscriptUpdate } from './transcript-events.js';
import { isAppendOnlyLlmTranscriptMessage } from './transcript-stats.js';

const log = createLogger('SessionStore');

const INDEX_VERSION = '1.0';

export interface SessionStoreOptions {
  config: Config;
  /** @deprecated SQLite is global; ignored. */
  agentId?: string;
  /** @deprecated SQLite is global; ignored. */
  sessionsDir?: string;
}

export class SessionStore {
  private window: SlidingWindow;
  private compactor: SessionCompactor;
  private storeMutationDepth = 0;
  private storeMutationChain: Promise<void> = Promise.resolve();

  constructor(
    private options: SessionStoreOptions,
    windowConfig?: Partial<WindowConfig>,
    compactionConfig?: Partial<CompactionConfig>,
  ) {
    this.window = new SlidingWindow(windowConfig);
    this.compactor = new SessionCompactor(compactionConfig);
  }

  private resolveWorkspaceCwd(sessionKey: string): string {
    return resolveEffectiveAgentProfileForSession(this.options.config, sessionKey).resolvedWorkspacePath;
  }

  private ensureDatabase(): void {
    if (!isXopcDatabaseOpen()) {
      openXopcDatabase();
    }
  }

  private async runStoreMutation<T>(fn: () => Promise<T>): Promise<T> {
    if (this.storeMutationDepth > 0) {
      return fn();
    }
    const run = this.storeMutationChain.then(async () => {
      this.storeMutationDepth++;
      try {
        return await fn();
      } finally {
        this.storeMutationDepth--;
      }
    });
    this.storeMutationChain = run.then(() => undefined).catch(() => undefined);
    return run as Promise<T>;
  }

  async initialize(): Promise<void> {
    this.ensureDatabase();
    log.debug('Session store initialized (SQLite)');
  }

  getSessionsRoot(): string {
    return resolveStateDir();
  }

  async resolveTranscriptPath(
    sessionKey: string,
  ): Promise<{ sessionId: string; sessionKey: string }> {
    this.ensureDatabase();
    const cwd = this.resolveWorkspaceCwd(sessionKey);
    const meta = ensureSessionRecord(sessionKey, cwd);
    return { sessionId: meta.transcriptId!, sessionKey };
  }

  async appendTranscriptMessage(sessionKey: string, message: AgentMessage): Promise<void> {
    return this.runStoreMutation(async () => {
      this.ensureDatabase();
      const cwd = this.resolveWorkspaceCwd(sessionKey);
      ensureSessionRecord(sessionKey, cwd);
      appendTranscriptEntry(sessionKey, message);
    });
  }

  async getByAgent(agentId: string): Promise<SessionMetadata[]> {
    this.ensureDatabase();
    return listSessionsByAgent(agentId);
  }

  async getByAccount(accountId: string): Promise<SessionMetadata[]> {
    const { items } = await this.list({ limit: 100_000 });
    return items.filter((m) => m.routing?.accountId === accountId);
  }

  async getByPeer(peerKind: string, peerId: string): Promise<SessionMetadata[]> {
    const { items } = await this.list({ limit: 100_000 });
    return items.filter((m) => m.routing?.peerKind === peerKind && m.routing.peerId === peerId);
  }

  async getMainSession(channel: string, accountId: string): Promise<SessionMetadata | null> {
    const { items } = await this.list({ limit: 100_000 });
    return (
      items.find(
        (m) =>
          m.routing?.source === channel &&
          m.routing.accountId === accountId &&
          m.routing.peerKind === 'dm' &&
          m.routing.peerId === 'main',
      ) ?? null
    );
  }

  async refreshIndex(): Promise<void> {
    /* no-op: SQLite is authoritative */
  }

  async list(query: SessionListQuery = {}): Promise<PaginatedResult<SessionMetadata>> {
    this.ensureDatabase();
    return listSessionMetadata(query);
  }

  async get(
    key: string,
    options?: { includeTranscriptSummary?: boolean; includeTranscriptRows?: boolean },
  ): Promise<SessionDetail | null> {
    const metadata = await this.getMetadata(key);
    if (!metadata) {
      return null;
    }
    const messages = await this.loadDisplayMessages(key);
    return this.buildSessionDetail(key, metadata, messages, options);
  }

  async getMessagePage(
    key: string,
    options: {
      offset?: number;
      limit?: number;
      before?: string;
      includeTranscriptSummary?: boolean;
      includeTranscriptRows?: boolean;
    } = {},
  ): Promise<{
    session: SessionDetail;
    pagination: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
      before?: string;
      nextBeforeCursor?: string;
    };
  } | null> {
    const metadata = await this.getMetadata(key);
    if (!metadata) {
      return null;
    }

    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const parsedBefore = options.before ? Number.parseInt(options.before, 10) : undefined;
    const hasBeforeCursor = parsedBefore !== undefined && Number.isFinite(parsedBefore);

    const displayMessages = await this.loadDisplayMessages(key);
    const page = this.paginateDisplayMessages(displayMessages, {
      limit,
      offset: hasBeforeCursor ? undefined : offset,
      beforeEndIndex: hasBeforeCursor ? parsedBefore : undefined,
    });

    const session = await this.buildSessionDetail(key, metadata, page.messages, options);
    const nextBeforeCursor = page.startIndex > 0 ? String(page.startIndex) : undefined;

    return {
      session,
      pagination: {
        total: page.total,
        limit,
        offset,
        hasMore: hasBeforeCursor ? page.startIndex > 0 : offset + limit < page.total,
        ...(hasBeforeCursor ? { before: String(page.endIndex) } : {}),
        ...(nextBeforeCursor ? { nextBeforeCursor } : {}),
      },
    };
  }

  private async buildSessionDetail(
    key: string,
    metadata: SessionMetadata,
    messages: AgentMessage[],
    options?: { includeTranscriptSummary?: boolean; includeTranscriptRows?: boolean },
  ): Promise<SessionDetail> {
    let transcriptSummary: SessionTranscriptSummary | undefined;
    if (options?.includeTranscriptSummary) {
      const env = await this.loadTranscriptDocument(key);
      if (env) {
        transcriptSummary = {
          id: env.id,
          version: env.version,
          createdAt: env.createdAt,
          updatedAt: env.updatedAt,
          compactionCount: env.compactions?.length ?? 0,
        };
      }
    }
    let transcriptRows: TranscriptStoredRow[] | undefined;
    if (options?.includeTranscriptRows) {
      transcriptRows = await this.loadTranscriptRows(key);
    }
    return {
      ...metadata,
      messages: this.convertMessages(messages),
      ...(transcriptSummary ? { transcriptSummary } : {}),
      ...(transcriptRows !== undefined ? { transcriptRows } : {}),
    };
  }

  async loadTranscriptRows(key: string): Promise<TranscriptStoredRow[]> {
    this.ensureDatabase();
    return loadTranscriptRowsForSession(key);
  }

  async getMetadata(key: string): Promise<SessionMetadata | null> {
    this.ensureDatabase();
    return getSessionMetadata(key);
  }

  async updateMetadata(key: string, updates: Partial<SessionMetadata>): Promise<void> {
    return this.runStoreMutation(async () => {
      this.ensureDatabase();
      patchSessionMetadata(key, updates);
      log.debug({ key, updates }, 'Session metadata updated');
    });
  }

  async reset(key: string): Promise<{ sessionId: string; previousSessionId: string } | null> {
    return this.runStoreMutation(async () => {
      this.ensureDatabase();
      const cwd = this.resolveWorkspaceCwd(key);
      const outcome = resetSessionRecord(key, cwd);
      if (outcome) {
        log.info({ key, ...outcome }, 'Session reset');
      }
      return outcome;
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.runStoreMutation(async () => {
      this.ensureDatabase();
      const ok = deleteSessionRecord(key);
      if (ok) {
        log.info({ key }, 'Session deleted');
      }
      return ok;
    });
  }

  async deleteMany(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    const success: string[] = [];
    const failed: string[] = [];
    for (const key of keys) {
      try {
        if (await this.delete(key)) {
          success.push(key);
        } else {
          failed.push(key);
        }
      } catch {
        failed.push(key);
      }
    }
    return { success, failed };
  }

  async setStatus(key: string, status: SessionStatus): Promise<void> {
    await this.updateMetadata(key, { status });
  }

  async archive(key: string): Promise<void> {
    await this.setStatus(key, SessionStatus.ARCHIVED);
  }

  async unarchive(key: string): Promise<void> {
    await this.setStatus(key, SessionStatus.ACTIVE);
  }

  async pin(key: string): Promise<void> {
    await this.setStatus(key, SessionStatus.PINNED);
  }

  async unpin(key: string): Promise<void> {
    await this.setStatus(key, SessionStatus.ACTIVE);
  }

  async loadMessages(_key: string, _options?: { fromArchive?: boolean }): Promise<AgentMessage[]> {
    this.ensureDatabase();
    return loadLlmMessagesForSession(_key);
  }

  async loadTranscriptDocument(key: string): Promise<XopcSessionTranscriptV1 | null> {
    const metadata = await this.getMetadata(key);
    if (!metadata?.transcriptId) {
      return null;
    }
    const rows = await this.loadTranscriptRows(key);
    const compactions: TranscriptCompactionRecord[] = [];
    for (const row of rows) {
      if ((row as { type?: string }).type === 'compaction') {
        const c = row as unknown as TranscriptCompactionRecord & { type: 'compaction' };
        compactions.push({
          at: c.at ?? new Date().toISOString(),
          summary: c.summary ?? '',
          firstKeptIndex: Number(c.firstKeptIndex ?? 0),
          tokensBefore: c.tokensBefore ?? 0,
          tokensAfter: (c as { tokensAfter?: number }).tokensAfter ?? 0,
        });
      }
    }
    return {
      type: 'xopc_session_transcript',
      version: 1,
      id: metadata.transcriptId,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      messages: rows,
      ...(compactions.length > 0 ? { compactions } : {}),
    };
  }

  async syncEmbeddedTranscriptUpdate(update: SessionTranscriptUpdate): Promise<void> {
    const sessionKey = update.sessionKey?.trim();
    if (!sessionKey) {
      return;
    }
    return this.runStoreMutation(async () => {
      this.ensureDatabase();
      const cwd = this.resolveWorkspaceCwd(sessionKey);
      ensureSessionRecord(sessionKey, cwd);

      if (update.message && isAppendOnlyLlmTranscriptMessage(update.message)) {
        appendTranscriptEntry(sessionKey, update.message as AgentMessage);
      }
    });
  }

  async appendTranscriptContextEntry(
    key: string,
    entry: Omit<XopcTranscriptContextEntry, 'kind'> & Partial<Pick<XopcTranscriptContextEntry, 'kind'>>,
  ): Promise<void> {
    return this.runStoreMutation(async () => {
      this.ensureDatabase();
      const cwd = this.resolveWorkspaceCwd(key);
      ensureSessionRecord(key, cwd);
      const row: XopcTranscriptContextEntry = {
        kind: 'context',
        id: typeof entry.id === 'string' ? entry.id : undefined,
        text: typeof entry.text === 'string' ? entry.text : undefined,
        data: entry.data,
        createdAt: entry.createdAt ?? new Date().toISOString(),
      };
      appendTranscriptEntry(key, row);
    });
  }

  async saveMessages(key: string, messages: AgentMessage[]): Promise<void> {
    return this.runStoreMutation(async () => {
      this.ensureDatabase();
      const cwd = this.resolveWorkspaceCwd(key);
      ensureSessionRecord(key, cwd);
      const prev = await this.loadTranscriptRows(key);
      const merged = mergeLlmMessagesPreservingContextRows(prev, messages);
      replaceTranscriptRows(key, merged);
    });
  }

  getWindowStats(messages: AgentMessage[]) {
    return this.window.getStats(messages);
  }

  needsCompaction(key: string, messages: AgentMessage[], contextWindow: number) {
    return this.compactor.needsCompaction(messages, contextWindow);
  }

  prepareCompaction(key: string, messages: AgentMessage[], contextWindow: number) {
    const result = this.compactor.needsCompaction(messages, contextWindow);
    return { needsCompaction: result.needed, messages, stats: result };
  }

  async applyCompaction(
    key: string,
    messages: AgentMessage[],
    result: CompactionResult,
  ): Promise<AgentMessage[]> {
    const compacted = this.compactor.applyCompaction(messages, result);
    return this.runStoreMutation(async () => {
      const prev = await this.loadTranscriptRows(key);
      const merged = mergeLlmMessagesPreservingContextRows(prev, compacted);
      captureCompactionCheckpoint(key);
      replaceTranscriptRows(key, merged, {
        appendCompaction: {
          at: new Date().toISOString(),
          summary: result.summary,
          firstKeptIndex: result.firstKeptIndex,
          tokensBefore: result.tokensBefore,
          tokensAfter: result.tokensAfter,
        },
      });
      const metadata = await this.getMetadata(key);
      if (metadata) {
        await this.updateMetadata(key, { compactedCount: metadata.compactedCount + 1 });
      }
      log.info(
        { key, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter, keptMessages: compacted.length },
        'Session compacted',
      );
      await this.injectPostCompactionContext(key);
      return compacted;
    });
  }

  async compact(
    key: string,
    messages: AgentMessage[],
    contextWindow: number,
    instructions?: string,
    force?: boolean,
  ): Promise<CompactionResult> {
    void contextWindow;
    const result = await this.compactor.compact(messages, instructions, force);
    if (result.compacted) {
      await this.applyCompaction(key, messages, result);
    }
    return result;
  }

  async getCompactionStats(key: string) {
    const metadata = await this.getMetadata(key);
    if (!metadata) {
      return undefined;
    }
    return {
      compactionCount: metadata.compactedCount,
      totalTokensBefore: 0,
      totalTokensAfter: 0,
      lastCompactionAt: undefined,
    };
  }

  async listCompactionCheckpoints(key: string): Promise<CompactionCheckpointSummary[]> {
    this.ensureDatabase();
    return listCompactionCheckpoints(key);
  }

  async getCompactionCheckpointDetail(
    key: string,
    checkpointId: string,
  ): Promise<CompactionCheckpointDetail | null> {
    this.ensureDatabase();
    const id = normalizeCompactionCheckpointId(checkpointId);
    if (!id) {
      return null;
    }
    return getCompactionCheckpointDetail(key, id);
  }

  async restoreCompactionCheckpoint(key: string, checkpointId: string): Promise<void> {
    return this.runStoreMutation(async () => {
      this.ensureDatabase();
      const id = normalizeCompactionCheckpointId(checkpointId);
      if (!id) {
        throw new Error(`Invalid checkpoint id: ${checkpointId}`);
      }
      restoreCompactionCheckpoint(key, id);
    });
  }

  async deleteSession(key: string): Promise<boolean> {
    return this.delete(key);
  }

  async load(key: string, options?: { fromArchive?: boolean }): Promise<AgentMessage[]> {
    return this.loadMessages(key, options);
  }

  async estimateTokenUsage(_key: string, messages: AgentMessage[]): Promise<number> {
    return this.estimateTokens(messages);
  }

  async searchInSession(key: string, keyword: string): Promise<Message[]> {
    const messages = await this.loadDisplayMessages(key);
    const q = keyword.toLowerCase();
    return this.convertMessages(
      messages.filter((m) => this.extractTextContent(this.messageContent(m)).toLowerCase().includes(q)),
    );
  }

  async exportSession(key: string, format: ExportFormat): Promise<string> {
    const metadata = await this.getMetadata(key);
    if (!metadata) {
      throw new Error(`Session not found: ${key}`);
    }
    const rows = await this.loadTranscriptRows(key);
    const messages = this.convertMessages(buildSessionContextForLlm(rows));
    const payload: SessionExport = {
      version: INDEX_VERSION,
      exportedAt: new Date().toISOString(),
      metadata,
      messages,
      transcriptRows: rows,
    };
    if (format === 'json') {
      return JSON.stringify(payload, null, 2);
    }
    const lines = [`# ${metadata.name ?? metadata.key}`, '', `Exported: ${payload.exportedAt}`, ''];
    for (const msg of messages) {
      lines.push(`## ${msg.role}`, '', typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content), '');
    }
    return lines.join('\n');
  }

  async getStats(): Promise<GlobalSessionStats> {
    this.ensureDatabase();
    return getGlobalSessionStats();
  }

  async archiveOld(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const list = await this.list({ limit: 100_000 });
    let archived = 0;
    for (const session of list.items) {
      if (session.status !== SessionStatus.ARCHIVED && session.status !== SessionStatus.PINNED) {
        const lastAccess = new Date(session.lastAccessedAt);
        if (lastAccess < cutoff) {
          await this.archive(session.key);
          archived++;
        }
      }
    }
    return archived;
  }

  estimateTokens(messages: AgentMessage[]): number {
    return estimateTokensFromMessages(messages);
  }

  private async loadDisplayMessages(key: string): Promise<AgentMessage[]> {
    const checkpoints = listCompactionCheckpoints(key);
    const rowSets: TranscriptStoredRow[][] = [];
    for (const checkpoint of [...checkpoints].reverse()) {
      rowSets.push(loadCheckpointRows(key, checkpoint.id));
    }
    rowSets.push(await this.loadTranscriptRows(key));

    const messages: AgentMessage[] = [];
    const seen = new Set<string>();
    for (const rows of rowSets) {
      for (const message of buildSessionContextForLlm(rows)) {
        if (this.isCompactionSummaryMessage(message)) {
          continue;
        }
        const identity = this.displayMessageIdentity(message);
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        messages.push(message);
      }
    }
    return messages;
  }

  private paginateDisplayMessages(
    messages: AgentMessage[],
    options: {
      offset?: number;
      limit?: number;
      beforeEndIndex?: number;
    } = {},
  ): { messages: AgentMessage[]; total: number; startIndex: number; endIndex: number } {
    const total = messages.length;
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));

    let startIndex: number;
    let endIndex: number;
    if (options.beforeEndIndex !== undefined && Number.isFinite(options.beforeEndIndex)) {
      endIndex = Math.min(total, Math.max(0, Math.trunc(options.beforeEndIndex)));
      startIndex = Math.max(0, endIndex - limit);
    } else {
      endIndex = Math.max(0, total - offset);
      startIndex = Math.max(0, endIndex - limit);
    }

    return {
      messages: messages.slice(startIndex, endIndex),
      total,
      startIndex,
      endIndex,
    };
  }

  private displayMessageIdentity(message: AgentMessage): string {
    const record = message as unknown as Record<string, unknown>;
    return JSON.stringify({
      role: message.role,
      timestamp: record.timestamp,
      toolCallId: record.toolCallId ?? record.tool_call_id,
      toolName: record.toolName,
      content: this.messageContent(message),
    });
  }

  private messageContent(msg: AgentMessage): unknown {
    return (msg as { content?: unknown }).content;
  }

  private isCompactionSummaryMessage(msg: AgentMessage): boolean {
    if (msg.role !== 'user') {
      return false;
    }
    const text = this.extractTextContent(this.messageContent(msg)).trim();
    return /^\[Previous conversation summary\]/i.test(text);
  }

  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (typeof item !== 'object' || item === null || !('type' in item)) {
          continue;
        }
        const c = item as { type?: string; text?: string; name?: string };
        if (c.type === 'text' && typeof c.text === 'string') {
          parts.push(c.text);
        } else if (c.type === 'toolCall' || c.type === 'tool_use') {
          parts.push(c.name ? `[${c.name}]` : '');
        }
      }
      return parts.join('');
    }
    return '';
  }

  private async injectPostCompactionContext(key: string): Promise<void> {
    const contextText = readPostCompactionContext({
      cfg: this.options.config,
      sessionKey: key,
    });
    if (!contextText?.trim()) {
      return;
    }
    try {
      await this.appendTranscriptContextEntry(key, {
        id: `post-compaction-${Date.now()}`,
        text: contextText,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      log.warn({ err, key }, 'Post-compaction context injection failed');
    }
  }

  private convertMessages(messages: AgentMessage[]): Message[] {
    return messages.map((m: AgentMessage & Record<string, unknown>) => {
      const c = this.messageContent(m);
      const content: string | unknown[] =
        typeof c === 'string' ? c : Array.isArray(c) ? c : this.extractTextContent(c);
      const row: Message = {
        role: m.role as Message['role'],
        content,
        timestamp: m.timestamp ? new Date(m.timestamp as string | number).toISOString() : undefined,
        tool_call_id: (m.tool_call_id as string | undefined) || (m.toolCallId as string | undefined),
        tool_calls: m.tool_calls as Message['tool_calls'],
        name: m.name as string | undefined,
      };
      if (Array.isArray(m.attachments) && m.attachments.length > 0) {
        row.attachments = m.attachments as Message['attachments'];
      }
      const rawUsage = m.usage as { input?: number; output?: number; totalTokens?: number; total?: number } | undefined;
      if (rawUsage && typeof rawUsage === 'object') {
        const inputTokens = typeof rawUsage.input === 'number' ? rawUsage.input : undefined;
        const outputTokens = typeof rawUsage.output === 'number' ? rawUsage.output : undefined;
        const totalTokens = typeof rawUsage.totalTokens === 'number'
          ? rawUsage.totalTokens
          : typeof rawUsage.total === 'number'
            ? rawUsage.total
            : undefined;
        if (inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined) {
          row.usage = { inputTokens, outputTokens, totalTokens };
        }
      }
      return row;
    });
  }
}
