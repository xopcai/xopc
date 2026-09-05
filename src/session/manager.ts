// Session manager - high-level session management service

import EventEmitter from 'events';
import type { Api, Model } from '@earendil-works/pi-ai/compat';

import { createLogger } from '../utils/logger.js';
import { SessionStore } from './store.js';
import type {
  SessionMetadata,
  SessionDetail,
  SessionListQuery,
  PaginatedResult,
  GlobalSessionStats,
  ExportFormat,
  SessionStatus,
} from './types.js';
import type { SessionMetadataSeed } from '../storage/sqlite/index.js';
import type { Message } from './types.js';
import type {
  CompactionConfig,
  CompactionExecutionOptions,
  CompactionResult,
} from '../agent/memory/compaction.js';
import type { XopcSessionTranscriptV1 } from './transcript-format.js';
import type { XopcTranscriptContextEntry } from './session-context-for-llm.js';
import { applySessionPatchToMetadata, type SessionPatchBody } from './patch-metadata.js';
import type { WindowConfig } from '../agent/memory/window.js';
import type { Config } from '../config/schema.js';

const log = createLogger('SessionIndex');

export interface SessionIndexConfig {
  config: Config;
  windowConfig?: Partial<WindowConfig>;
  compactionConfig?: Partial<CompactionConfig>;
}

export class SessionIndex extends EventEmitter {
  private store: SessionStore;

  constructor(config: SessionIndexConfig) {
    super();
    this.store = new SessionStore(
      {
        config: config.config,
      },
      config.windowConfig,
      config.compactionConfig
    );
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    this.emit('ready');
  }

  /** Low-level store (e.g. cron resolving weixin delivery from session index). */
  getStore(): SessionStore {
    return this.store;
  }

  // ========== CRUD Operations ==========

  async listSessions(query?: SessionListQuery): Promise<PaginatedResult<SessionMetadata>> {
    return this.store.list(query);
  }

  async listSubagents(query: SessionListQuery = {}): Promise<PaginatedResult<SessionMetadata>> {
    return this.store.list({
      ...query,
      sessionTypes: ['workflow-subagent'],
      includeHidden: true,
    });
  }

  async getSession(
    key: string,
    options?: { includeTranscriptSummary?: boolean; includeTranscriptRows?: boolean },
  ): Promise<SessionDetail | null> {
    const session = await this.store.get(key, options);
    if (session) {
      this.emit('sessionAccessed', { key });
    }
    return session;
  }

  async getSessionMessagePage(
    key: string,
    options?: {
      offset?: number;
      limit?: number;
      before?: string;
      includeTranscriptSummary?: boolean;
      includeTranscriptRows?: boolean;
      includeContextRows?: boolean;
    },
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
    const result = await this.store.getMessagePage(key, options);
    if (result) {
      this.emit('sessionAccessed', { key });
    }
    return result;
  }

  /**
   * OpenClaw-style `sessions.patch`: partial metadata (name, tags, customData shallow merge).
   */
  async patchSession(
    key: string,
    patch: SessionPatchBody,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const meta = await this.store.getMetadata(key);
    if (!meta) {
      return { ok: false, error: 'Session not found' };
    }
    const updates = applySessionPatchToMetadata(meta, patch);
    if (Object.keys(updates).length === 0) {
      return { ok: true };
    }
    await this.store.updateMetadata(key, updates);
    this.emit('sessionUpdated', { key });
    return { ok: true };
  }

  async getSessionMetadata(key: string): Promise<SessionMetadata | null> {
    return this.store.getMetadata(key);
  }

  async resolveSessionKeyBySessionId(sessionId: string): Promise<string | null> {
    return this.store.resolveKeyBySessionId(sessionId);
  }

  async deleteSession(key: string): Promise<boolean> {
    const result = await this.store.delete(key);
    if (result) {
      this.emit('sessionDeleted', { key });
    }
    return result;
  }

  async deleteSessions(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    const result = await this.store.deleteMany(keys);
    for (const key of result.success) {
      this.emit('sessionDeleted', { key });
    }
    return result;
  }

  // ========== Metadata Updates ==========

  async renameSession(key: string, name: string): Promise<void> {
    const existing = await this.store.getMetadata(key);
    await this.store.updateMetadata(key, {
      name,
      customData: { ...(existing?.customData ?? {}), titleSource: 'user' },
    });
    this.emit('sessionUpdated', { key, name });
  }

  /** Partial metadata update (caller merges nested fields like `customData` when needed). */
  async updateSessionMetadata(key: string, updates: Partial<SessionMetadata>): Promise<void> {
    await this.store.updateMetadata(key, updates);
    this.emit('sessionUpdated', { key });
  }

  async tagSession(key: string, tags: string[]): Promise<void> {
    const existing = await this.store.getMetadata(key);
    if (!existing) {
      throw new Error(`Session not found: ${key}`);
    }

    // Merge tags, remove duplicates
    const mergedTags = [...new Set([...existing.tags, ...tags])];
    await this.store.updateMetadata(key, { tags: mergedTags });
    this.emit('sessionUpdated', { key, tags: mergedTags });
  }

  async untagSession(key: string, tags: string[]): Promise<void> {
    const existing = await this.store.getMetadata(key);
    if (!existing) {
      throw new Error(`Session not found: ${key}`);
    }

    const filteredTags = existing.tags.filter((t) => !tags.includes(t));
    await this.store.updateMetadata(key, { tags: filteredTags });
    this.emit('sessionUpdated', { key, tags: filteredTags });
  }

  async setSessionTags(key: string, tags: string[]): Promise<void> {
    await this.store.updateMetadata(key, { tags: [...new Set(tags)] });
    this.emit('sessionUpdated', { key, tags });
  }

  // ========== Status Management ==========

  async archiveSession(key: string): Promise<void> {
    await this.store.archive(key);
    this.emit('sessionArchived', { key });
  }

  async unarchiveSession(key: string): Promise<void> {
    await this.store.unarchive(key);
    this.emit('sessionRestored', { key });
  }

  async pinSession(key: string): Promise<void> {
    await this.store.pin(key);
    this.emit('sessionPinned', { key });
  }

  async unpinSession(key: string): Promise<void> {
    await this.store.unpin(key);
    this.emit('sessionUnpinned', { key });
  }

  async setSessionStatus(key: string, status: SessionStatus): Promise<void> {
    await this.store.setStatus(key, status);
    this.emit('sessionStatusChanged', { key, status });
  }

  // ========== Search ==========

  async searchSessions(query: string): Promise<SessionMetadata[]> {
    const result = await this.store.list({ search: query, sessionTypes: ['chat'], limit: 100 });
    return result.items;
  }

  async searchInSession(key: string, keyword: string): Promise<Message[]> {
    return this.store.searchInSession(key, keyword);
  }

  // ========== Export/Import ==========

  async exportSession(key: string, format: ExportFormat): Promise<string> {
    return this.store.exportSession(key, format);
  }

  async importSessionExport(
    targetKey: string,
    jsonContent: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    const result = await this.store.importSessionExport(targetKey, jsonContent);
    const metadata = await this.store.getMetadata(result.sessionKey);
    if (metadata) {
      this.emit('sessionCreated', metadata);
    }
    return result;
  }

  async forkSession(
    sourceKey: string,
    targetKey: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    const result = await this.store.forkSession(sourceKey, targetKey);
    const metadata = await this.store.getMetadata(result.sessionKey);
    if (metadata) {
      this.emit('sessionCreated', metadata);
    }
    return result;
  }

  async forkSessionRows(
    sourceKey: string,
    targetKey: string,
    options: { throughRow?: number } = {},
  ): Promise<{ sessionKey: string; rowCount: number }> {
    const result = await this.store.forkSessionRows(sourceKey, targetKey, options);
    const metadata = await this.store.getMetadata(result.sessionKey);
    if (metadata) {
      this.emit('sessionCreated', metadata);
    }
    return result;
  }

  async forkSessionAtTurn(
    sourceKey: string,
    options: import('./store.js').ForkSessionAtTurnOptions,
  ): Promise<import('./store.js').ForkSessionResult> {
    const result = await this.store.forkSessionAtTurn(sourceKey, options);
    const metadata = await this.store.getMetadata(result.sessionKey);
    if (metadata) this.emit('sessionCreated', metadata);
    return result;
  }

  // ========== Statistics ==========

  async getStats(): Promise<GlobalSessionStats> {
    return this.store.getStats();
  }

  // ========== Maintenance ==========

  async archiveOldSessions(olderThanDays: number): Promise<number> {
    const count = await this.store.archiveOld(olderThanDays);
    log.info({ count, olderThanDays }, 'Archived old sessions');
    return count;
  }

  // ========== Event Helpers ==========

  onSessionCreated(callback: (metadata: SessionMetadata) => void): void {
    this.on('sessionCreated', callback);
  }

  onSessionUpdated(callback: (data: { key: string; name?: string; tags?: string[] }) => void): void {
    this.on('sessionUpdated', callback);
  }

  onSessionDeleted(callback: (data: { key: string }) => void): void {
    this.on('sessionDeleted', callback);
  }

  onSessionArchived(callback: (data: { key: string }) => void): void {
    this.on('sessionArchived', callback);
  }

  onSessionRestored(callback: (data: { key: string }) => void): void {
    this.on('sessionRestored', callback);
  }

  onSessionPinned(callback: (data: { key: string }) => void): void {
    this.on('sessionPinned', callback);
  }

  onSessionUnpinned(callback: (data: { key: string }) => void): void {
    this.on('sessionUnpinned', callback);
  }

  onSessionStatusChanged(callback: (data: { key: string; status: SessionStatus }) => void): void {
    this.on('sessionStatusChanged', callback);
  }

  onSessionAccessed(callback: (data: { key: string }) => void): void {
    this.on('sessionAccessed', callback);
  }

  // ========== Store delegation (messages, compaction) ==========

  /** Load messages for a session key */
  async loadMessages(key: string) {
    return this.store.loadMessages(key);
  }

  /** Wrapped transcript document (stable id, compaction history); null if missing or not a valid envelope. */
  async loadTranscriptDocument(key: string): Promise<XopcSessionTranscriptV1 | null> {
    return this.store.loadTranscriptDocument(key);
  }

  /**
   * Runtime turns must use PiTranscriptManager.appendMessage; this entry point
   * is reserved for compaction, tests, and admin tools.
   */
  async saveMessages(
    key: string,
    messages: any[],
    options?: { metadata?: SessionMetadataSeed },
  ) {
    return this.store.saveMessages(key, messages, options);
  }

  async deleteUserRound(key: string, userRoundIndex: number) {
    const result = await this.store.deleteUserRound(key, userRoundIndex);
    if (result) {
      this.emit('sessionUpdated', { key });
    }
    return result;
  }

  /**
   * Append `kind: 'context'` transcript row (persisted, excluded from {@link loadMessages} / LLM).
   */
  async appendTranscriptContextEntry(
    key: string,
    entry: Omit<XopcTranscriptContextEntry, 'kind'> & Partial<Pick<XopcTranscriptContextEntry, 'kind'>>,
  ): Promise<void> {
    await this.store.appendTranscriptContextEntry(key, entry);
    this.emit('sessionUpdated', { key });
  }

  async appendTranscriptLabelEntry(
    key: string,
    entry: { targetId: string; label?: string },
  ): Promise<void> {
    await this.store.appendTranscriptLabelEntry(key, entry);
    this.emit('sessionUpdated', { key });
  }

  async appendTranscriptCustomEntry(
    key: string,
    entry: { customType: string; data?: unknown },
  ): Promise<void> {
    await this.store.appendTranscriptCustomEntry(key, entry);
    this.emit('sessionUpdated', { key });
  }

  async appendTranscriptCustomMessageEntry(
    key: string,
    entry: {
      expectedSessionId?: string;
      customType: string;
      content?: string | unknown[];
      display?: boolean;
      details?: unknown;
    },
  ): Promise<void> {
    await this.store.appendTranscriptCustomMessageEntry(key, entry);
    this.emit('sessionUpdated', { key });
  }

  async appendTranscriptBashExecutionEntry(
    key: string,
    entry: {
      command: string;
      output?: string;
      exitCode?: number | null;
      signal?: string | null;
      excludeFromContext?: boolean;
      truncated?: boolean;
      fullOutputPath?: string;
    },
  ): Promise<void> {
    await this.store.appendTranscriptBashExecutionEntry(key, entry);
    this.emit('sessionUpdated', { key });
  }

  /** Delete session data */
  async delete(key: string): Promise<void> {
    await this.store.delete(key);
  }

  /** Archive transcript and start a new session id for the same key. */
  async resetSession(
    key: string,
  ): Promise<{ sessionId: string; previousSessionId: string } | null> {
    const result = await this.store.reset(key);
    if (result) {
      this.emit('sessionUpdated', { key });
    }
    return result;
  }

  /** Token/window stats for a message list */
  getWindowStats(messages: any[]) {
    return this.store.getWindowStats(messages);
  }

  /** Compact session messages */
  compact(
    key: string,
    messages: any[],
    model: Model<Api>,
    instructions?: string,
    force?: boolean,
    executionOptions?: CompactionExecutionOptions,
  ): Promise<CompactionResult> {
    return this.store.compact(key, messages, model, instructions, force, executionOptions);
  }

  /** Compaction stats for a session */
  async getCompactionStats(key: string) {
    return this.store.getCompactionStats(key);
  }

  listCompactionBoundaries(key: string) {
    return this.store.listCompactionBoundaries(key);
  }

  restoreBeforeCompactionBoundary(key: string, compactionId: string) {
    return this.store.restoreBeforeCompactionBoundary(key, compactionId);
  }

  /** Estimate token usage for messages */
  async estimateTokenUsage(key: string, messages: any[]): Promise<number> {
    return this.store.estimateTokens(messages);
  }
}
