// Session store - manages session persistence, indexing, compaction, and sliding window

import { readFile, writeFile, mkdir, unlink, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { createLogger } from '../utils/logger.js';
import type {
  SessionMetadata,
  SessionDetail,
  SessionIndex,
  SessionListQuery,
  PaginatedResult,
  SessionStats,
  ExportFormat,
  SessionExport,
} from './types.js';
import { SessionStatus } from './types.js';
import type { Message } from '../types/index.js';
import { SessionCompactor, type CompactionConfig, type CompactionResult } from '../agent/memory/compaction.js';
import { SlidingWindow, type WindowConfig } from '../agent/memory/window.js';

const log = createLogger('SessionStore');

const INDEX_VERSION = '1.0';
const DEFAULT_LIMIT = 50;

export class SessionStore {
  private baseDir: string;
  private sessionsDir: string;
  private archiveDir: string;
  private indexFile: string;
  private indexCache: SessionIndex | null = null;
  private indexDirty = false;
  private window: SlidingWindow;
  private compactor: SessionCompactor;

  constructor(
    workspace: string,
    windowConfig?: Partial<WindowConfig>,
    compactionConfig?: Partial<CompactionConfig>
  ) {
    this.baseDir = workspace;
    this.sessionsDir = join(workspace, '.sessions');
    this.archiveDir = join(workspace, '.sessions', 'archive');
    this.indexFile = join(workspace, '.sessions', 'index.json');
    this.window = new SlidingWindow(windowConfig);
    this.compactor = new SessionCompactor(compactionConfig);
  }

  // ========== Initialization ==========

  async initialize(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await mkdir(this.archiveDir, { recursive: true });

    if (!existsSync(this.indexFile)) {
      await this.rebuildIndex();
    } else {
      await this.loadIndex();
    }

    log.info('Session store initialized');
  }

  // ========== Index Management ==========

  private async loadIndex(): Promise<SessionIndex> {
    if (this.indexCache) return this.indexCache;

    try {
      const data = await readFile(this.indexFile, 'utf-8');
      this.indexCache = JSON.parse(data) as SessionIndex;
      return this.indexCache;
    } catch {
      // Index corrupted or missing, rebuild
      return this.rebuildIndex();
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.indexCache) return;

    this.indexCache.lastUpdated = new Date().toISOString();
    await writeFile(this.indexFile, JSON.stringify(this.indexCache, null, 2));
    this.indexDirty = false;
  }

  private async rebuildIndex(): Promise<SessionIndex> {
    log.info('Rebuilding session index...');

    const sessions: SessionMetadata[] = [];

    // Scan sessions directory
    const files = await this.scanSessionFiles();

    for (const file of files) {
      if (file.endsWith('.json') && !file.endsWith('.meta.json')) {
        const key = this.fileNameToKey(file.replace('.json', ''));
        try {
          const metadata = await this.scanSessionFile(key);
          if (metadata) {
            sessions.push(metadata);
          }
        } catch (err) {
          log.warn({ key, err }, 'Failed to scan session file');
        }
      }
    }

    this.indexCache = {
      version: INDEX_VERSION,
      lastUpdated: new Date().toISOString(),
      sessions,
    };

    await this.saveIndex();
    log.info({ count: sessions.length }, 'Session index rebuilt');

    return this.indexCache;
  }

  private async scanSessionFiles(): Promise<string[]> {
    try {
      const files = await readdir(this.sessionsDir);
      return files.filter((f) => f.endsWith('.json') && f !== 'index.json');
    } catch {
      return [];
    }
  }

  private async scanSessionFile(key: string): Promise<SessionMetadata | null> {
    const messages = await this.loadMessages(key);
    if (messages.length === 0) return null;

    const safeKey = this.sanitizeKey(key);
    const filePath = join(this.sessionsDir, `${safeKey}.json`);
    const stats = await stat(filePath);

    const { channel, chatId } = this.parseSessionKey(key);

    return {
      key,
      status: SessionStatus.ACTIVE,
      tags: [],
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
      lastAccessedAt: stats.mtime.toISOString(),
      messageCount: messages.length,
      estimatedTokens: this.estimateTokens(messages),
      compactedCount: 0,
      sourceChannel: channel,
      sourceChatId: chatId,
    };
  }

  // ========== CRUD Operations ==========

  async list(query: SessionListQuery = {}): Promise<PaginatedResult<SessionMetadata>> {
    const index = await this.loadIndex();
    let sessions = [...index.sessions];

    // Apply filters
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      sessions = sessions.filter((s) => statuses.includes(s.status));
    }

    if (query.channel) {
      sessions = sessions.filter((s) => s.sourceChannel === query.channel);
    }

    if (query.tags && query.tags.length > 0) {
      sessions = sessions.filter((s) => query.tags!.some((tag) => s.tags.includes(tag)));
    }

    if (query.search) {
      const searchLower = query.search.toLowerCase();
      sessions = sessions.filter(
        (s) =>
          s.key.toLowerCase().includes(searchLower) ||
          s.name?.toLowerCase().includes(searchLower) ||
          s.tags.some((t) => t.toLowerCase().includes(searchLower))
      );
    }

    // Apply sorting
    const sortBy = query.sortBy || 'updatedAt';
    const sortOrder = query.sortOrder || 'desc';

    sessions.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const total = sessions.length;
    const limit = query.limit || DEFAULT_LIMIT;
    const offset = query.offset || 0;
    const items = sessions.slice(offset, offset + limit);

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async get(key: string): Promise<SessionDetail | null> {
    const metadata = await this.getMetadata(key);
    if (!metadata) return null;

    const messages = await this.loadMessages(key);

    return {
      ...metadata,
      messages: this.convertMessages(messages),
    };
  }

  async getMetadata(key: string): Promise<SessionMetadata | null> {
    const index = await this.loadIndex();
    const metadata = index.sessions.find((s) => s.key === key);

    if (!metadata) {
      // Try to load from file directly (orphaned session)
      const scanned = await this.scanSessionFile(key);
      if (scanned) {
        index.sessions.push(scanned);
        this.indexDirty = true;
        return scanned;
      }
      return null;
    }

    return metadata;
  }

  async updateMetadata(key: string, updates: Partial<SessionMetadata>): Promise<void> {
    const index = await this.loadIndex();
    const idx = index.sessions.findIndex((s) => s.key === key);

    if (idx === -1) {
      throw new Error(`Session not found: ${key}`);
    }

    index.sessions[idx] = {
      ...index.sessions[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.indexDirty = true;
    await this.saveIndex();

    log.debug({ key, updates }, 'Session metadata updated');
  }

  async delete(key: string): Promise<boolean> {
    const index = await this.loadIndex();
    const idx = index.sessions.findIndex((s) => s.key === key);

    // Delete files
    const safeKey = this.sanitizeKey(key);
    const sessionPath = join(this.sessionsDir, `${safeKey}.json`);
    const metaPath = join(this.sessionsDir, `${safeKey}.meta.json`);

    try {
      await unlink(sessionPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    try {
      await unlink(metaPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Remove from index
    if (idx !== -1) {
      index.sessions.splice(idx, 1);
      this.indexDirty = true;
      await this.saveIndex();
    }

    log.info({ key }, 'Session deleted');
    return true;
  }

  async deleteMany(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    const success: string[] = [];
    const failed: string[] = [];

    for (const key of keys) {
      try {
        await this.delete(key);
        success.push(key);
      } catch {
        failed.push(key);
      }
    }

    return { success, failed };
  }

  // ========== Status Operations ==========

  async setStatus(key: string, status: SessionStatus): Promise<void> {
    await this.updateMetadata(key, { status });

    if (status === SessionStatus.ARCHIVED) {
      await this.moveToArchive(key);
    } else {
      await this.moveFromArchive(key);
    }
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

  // ========== Message Operations ==========

  async loadMessages(key: string): Promise<AgentMessage[]> {
    const safeKey = this.sanitizeKey(key);
    const path = join(this.sessionsDir, `${safeKey}.json`);

    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data) as AgentMessage[];
    } catch {
      // Check archive
      const archivePath = join(this.archiveDir, `${safeKey}.json`);
      try {
        const data = await readFile(archivePath, 'utf-8');
        return JSON.parse(data) as AgentMessage[];
      } catch {
        return [];
      }
    }
  }

  async saveMessages(key: string, messages: AgentMessage[]): Promise<void> {
    const safeKey = this.sanitizeKey(key);
    const path = join(this.sessionsDir, `${safeKey}.json`);

    await mkdir(this.sessionsDir, { recursive: true });
    await writeFile(path, JSON.stringify(messages, null, 2));

    // Update or create metadata
    const index = await this.loadIndex();
    const existingIdx = index.sessions.findIndex((s) => s.key === key);
    const now = new Date().toISOString();

    const { channel, chatId } = this.parseSessionKey(key);

    if (existingIdx !== -1) {
      index.sessions[existingIdx] = {
        ...index.sessions[existingIdx],
        messageCount: messages.length,
        estimatedTokens: this.estimateTokens(messages),
        updatedAt: now,
        lastAccessedAt: now,
      };
    } else {
      index.sessions.push({
        key,
        status: SessionStatus.ACTIVE,
        tags: [],
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        messageCount: messages.length,
        estimatedTokens: this.estimateTokens(messages),
        compactedCount: 0,
        sourceChannel: channel,
        sourceChatId: chatId,
      });
    }

    this.indexDirty = true;
    await this.saveIndex();
  }

  // ========== Sliding Window & Compaction ==========

  /**
   * Get window stats for messages
   */
  getWindowStats(messages: AgentMessage[]) {
    return this.window.getStats(messages);
  }

  /**
   * Check if session needs compaction
   */
  needsCompaction(key: string, messages: AgentMessage[], contextWindow: number) {
    return this.compactor.needsCompaction(messages, contextWindow);
  }

  /**
   * Prepare compaction (check if needed)
   */
  prepareCompaction(
    key: string,
    messages: AgentMessage[],
    contextWindow: number
  ): { needsCompaction: boolean; messages: AgentMessage[]; stats?: ReturnType<typeof this.compactor.needsCompaction> } {
    const result = this.compactor.needsCompaction(messages, contextWindow);
    return {
      needsCompaction: result.needed,
      messages,
      stats: result,
    };
  }

  /**
   * Apply compaction result to messages
   */
  async applyCompaction(
    key: string,
    messages: AgentMessage[],
    result: CompactionResult
  ): Promise<AgentMessage[]> {
    const compacted = this.compactor.applyCompaction(messages, result);
    
    const metadata = await this.getMetadata(key);
    if (metadata) {
      await this.updateMetadata(key, {
        compactedCount: metadata.compactedCount + 1,
      });
    }
    
    log.info({
      key,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      keptMessages: compacted.length,
    }, 'Session compacted');
    
    return compacted;
  }

  /**
   * Compact session with LLM summary
   */
  async compact(
    key: string,
    messages: AgentMessage[],
    contextWindow: number,
    instructions?: string
  ): Promise<CompactionResult> {
    const result = await this.compactor.compact(messages, instructions);
    
    if (result.compacted) {
      await this.applyCompaction(key, messages, result);
    }
    
    return result;
  }

  /**
   * Get compaction stats for a session
   */
  async getCompactionStats(key: string) {
    const metadata = await this.getMetadata(key);
    if (!metadata) return undefined;
    
    return {
      compactionCount: metadata.compactedCount,
      totalTokensBefore: 0,
      totalTokensAfter: 0,
      lastCompactionAt: undefined,
    };
  }

  // ========== MemoryStore API Aliases ==========

  /** Alias for delete */
  async deleteSession(key: string): Promise<boolean> {
    return this.delete(key);
  }

  /** Alias for loadMessages */
  async load(key: string): Promise<AgentMessage[]> {
    return this.loadMessages(key);
  }

  /** Alias for saveMessages */
  async save(key: string, messages: AgentMessage[]): Promise<void> {
    return this.saveMessages(key, messages);
  }

  /** Alias for estimateTokens */
  async estimateTokenUsage(key: string, messages: AgentMessage[]): Promise<number> {
    return this.estimateTokens(messages);
  }

  // ========== Search ==========

  async searchInSession(key: string, keyword: string): Promise<Message[]> {
    const messages = await this.loadMessages(key);
    const keywordLower = keyword.toLowerCase();

    return this.convertMessages(
      messages.filter((m) => {
        const content = this.extractTextContent(m.content);
        return content.toLowerCase().includes(keywordLower);
      })
    );
  }

  // ========== Export/Import ==========

  async exportSession(key: string, format: ExportFormat): Promise<string> {
    const detail = await this.get(key);
    if (!detail) {
      throw new Error(`Session not found: ${key}`);
    }

    if (format === 'json') {
      const exportData: SessionExport = {
        version: INDEX_VERSION,
        exportedAt: new Date().toISOString(),
        metadata: detail,
        messages: detail.messages,
      };
      return JSON.stringify(exportData, null, 2);
    } else {
      // Markdown format
      const lines = [
        `# ${detail.name || detail.key}`,
        '',
        `- **Channel:** ${detail.sourceChannel}`,
        `- **Created:** ${detail.createdAt}`,
        `- **Messages:** ${detail.messageCount}`,
        `- **Tags:** ${detail.tags.join(', ') || 'none'}`,
        '',
        '---',
        '',
      ];

      for (const msg of detail.messages) {
        const role = msg.role === 'assistant' ? 'Assistant' : msg.role === 'user' ? 'User' : msg.role;
        lines.push(`## ${role}`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
        lines.push('---');
        lines.push('');
      }

      return lines.join('\n');
    }
  }

  // ========== Statistics ==========

  async getStats(): Promise<SessionStats> {
    const index = await this.loadIndex();
    const sessions = index.sessions;

    const byChannel: Record<string, number> = {};
    for (const s of sessions) {
      byChannel[s.sourceChannel] = (byChannel[s.sourceChannel] || 0) + 1;
    }

    let oldestSession: string | undefined;
    let newestSession: string | undefined;

    if (sessions.length > 0) {
      const sorted = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      oldestSession = sorted[0].createdAt;
      newestSession = sorted[sorted.length - 1].createdAt;
    }

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.status === SessionStatus.ACTIVE).length,
      archivedSessions: sessions.filter((s) => s.status === SessionStatus.ARCHIVED).length,
      pinnedSessions: sessions.filter((s) => s.status === SessionStatus.PINNED).length,
      totalMessages: sessions.reduce((sum, s) => sum + s.messageCount, 0),
      totalTokens: sessions.reduce((sum, s) => sum + s.estimatedTokens, 0),
      oldestSession,
      newestSession,
      byChannel,
    };
  }

  // ========== Cleanup ==========

  async archiveOld(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const index = await this.loadIndex();
    let archived = 0;

    for (const session of index.sessions) {
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

  // ========== Helper Methods ==========

  private sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private fileNameToKey(fileName: string): string {
    // Reverse of sanitizeKey - try to restore original format
    // telegram_123456 -> telegram:123456
    return fileName.replace(/^([^_]+)_(.+)$/, '$1:$2');
  }

  private parseSessionKey(key: string): { channel: string; chatId: string } {
    const parts = key.split(':');
    if (parts.length >= 2) {
      return { channel: parts[0], chatId: parts.slice(1).join(':') };
    }
    return { channel: 'unknown', chatId: key };
  }

  estimateTokens(messages: AgentMessage[]): number {
    // Rough estimate: 1 token ≈ 4 characters
    let total = 0;
    for (const msg of messages) {
      const text = this.extractTextContent(msg.content);
      total += Math.ceil(text.length / 4);
    }
    return total;
  }

  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => typeof c === 'object' && c !== null && 'type' in c && c.type === 'text')
        .map((c) => (c as { text?: string }).text || '')
        .join('');
    }
    return '';
  }

  private convertMessages(messages: AgentMessage[]): Message[] {
    return messages.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool' | 'toolResult',
      content: typeof m.content === 'string' ? m.content : this.extractTextContent(m.content),
      timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
      tool_call_id: m.tool_call_id || m.toolCallId,
      tool_calls: m.tool_calls,
      name: m.name,
    }));
  }

  private async moveToArchive(key: string): Promise<void> {
    const safeKey = this.sanitizeKey(key);
    const sourcePath = join(this.sessionsDir, `${safeKey}.json`);
    const targetPath = join(this.archiveDir, `${safeKey}.json`);

    try {
      const data = await readFile(sourcePath, 'utf-8');
      await writeFile(targetPath, data);
      await unlink(sourcePath);

      // Move meta file if exists
      const metaSource = join(this.sessionsDir, `${safeKey}.meta.json`);
      const metaTarget = join(this.archiveDir, `${safeKey}.meta.json`);
      try {
        const metaData = await readFile(metaSource, 'utf-8');
        await writeFile(metaTarget, metaData);
        await unlink(metaSource);
      } catch {
        // Meta file might not exist
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  private async moveFromArchive(key: string): Promise<void> {
    const safeKey = this.sanitizeKey(key);
    const sourcePath = join(this.archiveDir, `${safeKey}.json`);
    const targetPath = join(this.sessionsDir, `${safeKey}.json`);

    try {
      const data = await readFile(sourcePath, 'utf-8');
      await writeFile(targetPath, data);
      await unlink(sourcePath);

      // Move meta file if exists
      const metaSource = join(this.archiveDir, `${safeKey}.meta.json`);
      const metaTarget = join(this.sessionsDir, `${safeKey}.meta.json`);
      try {
        const metaData = await readFile(metaSource, 'utf-8');
        await writeFile(metaTarget, metaData);
        await unlink(metaSource);
      } catch {
        // Meta file might not exist
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  // ========== Legacy Compatibility ==========

  async migrateFromLegacy(): Promise<number> {
    // Migrate old .sessions/*.json files without index
    const files = await this.scanSessionFiles();
    let migrated = 0;

    for (const file of files) {
      if (file.endsWith('.json') && !file.endsWith('.meta.json')) {
        const key = this.fileNameToKey(file.replace('.json', ''));
        const metadata = await this.getMetadata(key);
        if (!metadata) {
          const scanned = await this.scanSessionFile(key);
          if (scanned) {
            const index = await this.loadIndex();
            index.sessions.push(scanned);
            migrated++;
          }
        }
      }
    }

    if (migrated > 0) {
      this.indexDirty = true;
      await this.saveIndex();
    }

    log.info({ migrated }, 'Migrated legacy sessions');
    return migrated;
  }
}
