// Session manager - high-level session management service

import EventEmitter from 'events';
import { createLogger } from '../utils/logger.js';
import { SessionStore } from './store.js';
import type {
  SessionMetadata,
  SessionDetail,
  SessionListQuery,
  PaginatedResult,
  SessionStats,
  ExportFormat,
  SessionStatus,
} from './types.js';
import type { Message } from '../types/index.js';
import type { CompactionConfig, CompactionResult } from '../agent/memory/compaction.js';
import type { WindowConfig } from '../agent/memory/window.js';

const log = createLogger('SessionManager');

export interface SessionManagerConfig {
  workspace: string;
  windowConfig?: Partial<WindowConfig>;
  compactionConfig?: Partial<CompactionConfig>;
}

export class SessionManager extends EventEmitter {
  private store: SessionStore;

  constructor(config: SessionManagerConfig) {
    super();
    this.store = new SessionStore(config.workspace, config.windowConfig, config.compactionConfig);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    this.emit('ready');
  }

  // ========== CRUD Operations ==========

  async listSessions(query?: SessionListQuery): Promise<PaginatedResult<SessionMetadata>> {
    return this.store.list(query);
  }

  async getSession(key: string): Promise<SessionDetail | null> {
    const session = await this.store.get(key);
    if (session) {
      this.emit('sessionAccessed', { key });
    }
    return session;
  }

  async getSessionMetadata(key: string): Promise<SessionMetadata | null> {
    return this.store.getMetadata(key);
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
    await this.store.updateMetadata(key, { name });
    this.emit('sessionUpdated', { key, name });
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
    const result = await this.store.list({ search: query, limit: 100 });
    return result.items;
  }

  async searchInSession(key: string, keyword: string): Promise<Message[]> {
    return this.store.searchInSession(key, keyword);
  }

  // ========== Export/Import ==========

  async exportSession(key: string, format: ExportFormat): Promise<string> {
    return this.store.exportSession(key, format);
  }

  // ========== Statistics ==========

  async getStats(): Promise<SessionStats> {
    return this.store.getStats();
  }

  // ========== Maintenance ==========

  async archiveOldSessions(olderThanDays: number): Promise<number> {
    const count = await this.store.archiveOld(olderThanDays);
    log.info({ count, olderThanDays }, 'Archived old sessions');
    return count;
  }

  async migrateFromLegacy(): Promise<number> {
    return this.store.migrateFromLegacy();
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

  // ========== Legacy Compatibility (MemoryStore API) ==========

  /** Load messages (MemoryStore API) */
  async loadMessages(key: string) {
    return this.store.loadMessages(key);
  }

  /** Save messages (MemoryStore API) */
  async saveMessages(key: string, messages: any[]) {
    return this.store.saveMessages(key, messages);
  }

  /** Delete session (MemoryStore API) */
  async delete(key: string): Promise<void> {
    await this.store.delete(key);
  }

  /** Get window stats (MemoryStore API) */
  getWindowStats(messages: any[]) {
    return this.store.getWindowStats(messages);
  }

  /** Prepare compaction (MemoryStore API) */
  prepareCompaction(key: string, messages: any[], contextWindow: number) {
    return this.store.prepareCompaction(key, messages, contextWindow);
  }

  /** Compact session (MemoryStore API) */
  compact(key: string, messages: any[], contextWindow: number, instructions?: string): Promise<CompactionResult> {
    return this.store.compact(key, messages, contextWindow, instructions);
  }

  /** Get compaction stats (MemoryStore API) */
  async getCompactionStats(key: string) {
    return this.store.getCompactionStats(key);
  }

  /** Estimate token usage (MemoryStore API) */
  async estimateTokenUsage(key: string, messages: any[]): Promise<number> {
    return this.store.estimateTokens(messages);
  }
}
