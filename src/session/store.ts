// Session store - manages session persistence, indexing, compaction, and sliding window

import { readFile, writeFile, mkdir, unlink, readdir, stat, cp } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { resolveSessionsDir, resolveAgentId, FILENAMES } from '../config/paths.js';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { createLogger } from '../utils/logger.js';
import type {
  SessionMetadata,
  SessionDetail,
  SessionIndex,
  SessionListQuery,
  PaginatedResult,
  GlobalSessionStats,
  ExportFormat,
  SessionExport,
} from './types.js';
import { SessionStatus } from './types.js';
import type { Message } from './types.js';
import { SessionCompactor, type CompactionConfig, type CompactionResult } from '../agent/memory/compaction.js';
import { SlidingWindow, type WindowConfig } from '../agent/memory/window.js';
import { cleanTrailingErrors, hasProblematicMessages } from '../agent/memory/message-sanitizer.js';

const log = createLogger('SessionStore');

const INDEX_VERSION = '1.0';
const DEFAULT_LIMIT = 50;

/**
 * Session files live under `resolveSessionsDir(agentId)` (ADR-003).
 * Optional `workspace` enables one-time migration from legacy `<workspace>/.sessions`.
 */
export interface SessionStoreOptions {
  /** Agent OS agent id (default: XOPCBOT_AGENT_ID or `main`) */
  agentId?: string;
  /**
   * Config workspace path (`agents.defaults.workspace`).
   * If legacy `<workspace>/.sessions` exists and the new store is empty, it is copied here.
   */
  workspace?: string;
  /** Override storage root (tests); skips `resolveSessionsDir` */
  sessionsDir?: string;
}

export class SessionStore {
  private readonly legacyWorkspace?: string;
  private sessionsDir: string;
  private archiveDir: string;
  private indexFile: string;
  private indexCache: SessionIndex | null = null;
  private indexCacheTime: number = 0;
  private indexDirty = false;
  private window: SlidingWindow;
  private compactor: SessionCompactor;

  constructor(
    options: SessionStoreOptions,
    windowConfig?: Partial<WindowConfig>,
    compactionConfig?: Partial<CompactionConfig>
  ) {
    const agentId = options.agentId ?? resolveAgentId();
    this.legacyWorkspace = options.workspace;
    this.sessionsDir = options.sessionsDir ?? resolveSessionsDir(agentId);
    this.archiveDir = join(this.sessionsDir, 'archive');
    this.indexFile = join(this.sessionsDir, FILENAMES.SESSIONS_INDEX);
    this.window = new SlidingWindow(windowConfig);
    this.compactor = new SessionCompactor(compactionConfig);
  }

  // ========== Initialization ==========

  async initialize(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await mkdir(this.archiveDir, { recursive: true });

    await this.maybeMigrateLegacyWorkspace();

    if (!existsSync(this.indexFile)) {
      await this.rebuildIndex();
    } else {
      await this.loadIndex();
    }

    log.debug('Session store initialized');
  }

  /**
   * Copy legacy `<workspace>/.sessions` into `agents/<agentId>/sessions/` when the new location is empty.
   */
  private async maybeMigrateLegacyWorkspace(): Promise<void> {
    if (!this.legacyWorkspace) return;

    const legacyDir = join(this.legacyWorkspace, '.sessions');
    if (!existsSync(legacyDir)) return;
    if (legacyDir === this.sessionsDir) return;

    const hasNewSessions = await this.hasNonEmptyIndex(this.indexFile);
    if (hasNewSessions) return;

    let legacyHasData = false;
    try {
      const names = await readdir(legacyDir);
      legacyHasData = names.some(
        (n) =>
          (n.endsWith('.json') && n !== FILENAMES.SESSIONS_INDEX) ||
          n === 'archive'
      );
    } catch {
      return;
    }
    if (!legacyHasData) return;

    try {
      const entries = await readdir(legacyDir, { withFileTypes: true });
      for (const ent of entries) {
        const src = join(legacyDir, ent.name);
        const dest = join(this.sessionsDir, ent.name);
        await cp(src, dest, { recursive: true, force: true });
      }
      log.info({ from: legacyDir, to: this.sessionsDir }, 'Migrated sessions from legacy workspace/.sessions');
      this.indexCache = null;
      this.indexCacheTime = 0;
    } catch (err) {
      log.warn({ err, legacyDir, target: this.sessionsDir }, 'Failed to migrate legacy sessions');
    }
  }

  private async hasNonEmptyIndex(indexPath: string): Promise<boolean> {
    if (!existsSync(indexPath)) return false;
    try {
      const raw = await readFile(indexPath, 'utf-8');
      const data = JSON.parse(raw) as SessionIndex;
      return Array.isArray(data.sessions) && data.sessions.length > 0;
    } catch {
      return false;
    }
  }

  // ========== Index Management ==========

  /**
   * Get sessions by agent ID
   */
  async getByAgent(agentId: string): Promise<SessionMetadata[]> {
    const index = await this.loadIndex();
    return (index.sessions || []).filter(
      (s) => s.routing?.agentId?.toLowerCase() === agentId.toLowerCase()
    );
  }

  /**
   * Get sessions by account ID
   */
  async getByAccount(accountId: string): Promise<SessionMetadata[]> {
    const index = await this.loadIndex();
    return (index.sessions || []).filter(
      (s) => s.routing?.accountId?.toLowerCase() === accountId.toLowerCase()
    );
  }

  /**
   * Get sessions by peer
   */
  async getByPeer(peerKind: string, peerId: string): Promise<SessionMetadata[]> {
    const index = await this.loadIndex();
    return (index.sessions || []).filter(
      (s) =>
        s.routing?.peerKind?.toLowerCase() === peerKind.toLowerCase() &&
        s.routing?.peerId?.toLowerCase() === peerId.toLowerCase()
    );
  }

  /**
   * Get main session for a DM conversation
   */
  async getMainSession(channel: string, accountId: string): Promise<SessionMetadata | null> {
    const index = await this.loadIndex();
    return (
      (index.sessions || []).find(
        (s) =>
          s.routing?.source?.toLowerCase() === channel.toLowerCase() &&
          s.routing?.accountId?.toLowerCase() === accountId.toLowerCase() &&
          s.routing?.peerKind?.toLowerCase() === 'dm' &&
          s.routing?.peerId === 'main'
      ) ?? null
    );
  }

  private async loadIndex(): Promise<SessionIndex> {
    try {
      // Check if index file has been modified
      const stats = await stat(this.indexFile);
      const mtime = stats.mtime.getTime();

      // If cache is valid and file hasn't changed, use cache
      if (this.indexCache && mtime <= this.indexCacheTime) {
        // Ensure sessions array exists
        if (!this.indexCache.sessions) {
          this.indexCache.sessions = [];
        }
        return this.indexCache;
      }

      // File has changed or cache is empty, reload
      const data = await readFile(this.indexFile, 'utf-8');
      const parsed = JSON.parse(data) as SessionIndex;
      // Ensure sessions array exists
      if (!parsed.sessions) {
        parsed.sessions = [];
      }
      this.indexCache = parsed;
      this.indexCacheTime = mtime;
      return this.indexCache;
    } catch {
      // Index corrupted or missing, rebuild
      return this.rebuildIndex();
    }
  }

  /**
   * Force refresh the index cache from disk
   */
  async refreshIndex(): Promise<void> {
    this.indexCache = null;
    this.indexCacheTime = 0;
    await this.loadIndex();
  }

  private async saveIndex(): Promise<void> {
    if (!this.indexCache) return;

    this.indexCache.lastUpdated = new Date().toISOString();
    await writeFile(this.indexFile, JSON.stringify(this.indexCache, null, 2));
    this.indexDirty = false;
    
    // Update cache time after saving
    try {
      const stats = await stat(this.indexFile);
      this.indexCacheTime = stats.mtime.getTime();
    } catch {
      this.indexCacheTime = Date.now();
    }
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
    
    // Update cache time after saving
    try {
      const stats = await stat(this.indexFile);
      this.indexCacheTime = stats.mtime.getTime();
    } catch {
      this.indexCacheTime = Date.now();
    }
    
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
    const routing = this.extractRoutingFromKey(key, channel);
    const isCronSession = channel === 'cron';

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
      routing,
      ...(isCronSession
        ? {
            sessionType: 'cron',
            customData: { cronJobId: chatId },
          }
        : {}),
      stats: {
        messageCount: messages.length,
        tokenCount: this.estimateTokens(messages),
      },
    };
  }

  /**
   * Extract routing metadata from session key
   */
  private extractRoutingFromKey(key: string, channel: string): SessionMetadata['routing'] {
    const parts = key.split(':');
    if (parts.length < 5) {
      return undefined;
    }

    const [agentId, source, accountId, peerKind, peerId, ...rest] = parts;
    
    let threadId: string | undefined;
    let scopeId: string | undefined;
    
    // Parse optional thread and scope
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === 'thread' && rest[i + 1]) {
        threadId = rest[i + 1];
        i++;
      } else if (rest[i] === 'scope' && rest[i + 1]) {
        scopeId = rest[i + 1];
        i++;
      }
    }

    return {
      agentId: agentId?.toLowerCase() || 'main',
      source: source?.toLowerCase() || channel,
      accountId: accountId?.toLowerCase() || 'default',
      peerKind: peerKind?.toLowerCase() || 'dm',
      peerId: peerId?.toLowerCase() || 'unknown',
      threadId,
      scopeId,
    };
  }

  // ========== CRUD Operations ==========

  async list(query: SessionListQuery = {}): Promise<PaginatedResult<SessionMetadata>> {
    const index = await this.loadIndex();
    let sessions = [...(index.sessions || [])];

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

  async loadMessages(key: string, options?: { fromArchive?: boolean }): Promise<AgentMessage[]> {
    const safeKey = this.sanitizeKey(key);
    const path = join(this.sessionsDir, `${safeKey}.json`);

    try {
      const data = await readFile(path, 'utf-8');
      const messages = JSON.parse(data) as AgentMessage[];

      // Defensive: Clean any trailing error messages from previous sessions
      // This prevents the vicious cycle where error messages cause subsequent API failures
      if (hasProblematicMessages(messages)) {
        const cleaned = cleanTrailingErrors(messages);
        if (cleaned.length !== messages.length) {
          log.info(
            { key, original: messages.length, cleaned: cleaned.length },
            'Cleaned problematic messages on load'
          );
        }
        return cleaned;
      }

      return messages;
    } catch {
      // Only check archive if explicitly requested (e.g., for restore command)
      // This prevents accidentally loading archived sessions after /new command
      if (options?.fromArchive) {
        const archivedFile = await this.findMostRecentArchive(safeKey);
        if (!archivedFile) {
          return [];
        }
        try {
          const data = await readFile(archivedFile, 'utf-8');
          const messages = JSON.parse(data) as AgentMessage[];

          // Also clean archived messages
          if (hasProblematicMessages(messages)) {
            return cleanTrailingErrors(messages);
          }
          return messages;
        } catch {
          return [];
        }
      }
      return [];
    }
  }

  /**
   * Find the most recent archived session file for a given key.
   * Archived files have format: {safeKey}.{timestamp}.json
   */
  private async findMostRecentArchive(safeKey: string): Promise<string | null> {
    try {
      const files = await readdir(this.archiveDir);
      const matchingFiles = files
        .filter((f) => f.startsWith(`${safeKey}.`) && f.endsWith('.json') && !f.endsWith('.meta.json'))
        .sort()
        .reverse();

      if (matchingFiles.length === 0) {
        return null;
      }

      return join(this.archiveDir, matchingFiles[0]);
    } catch {
      return null;
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
    const routing = this.extractRoutingFromKey(key, channel);
    const isCronSession = channel === 'cron';

    if (existingIdx !== -1) {
      const prev = index.sessions[existingIdx];
      index.sessions[existingIdx] = {
        ...prev,
        messageCount: messages.length,
        estimatedTokens: this.estimateTokens(messages),
        updatedAt: now,
        lastAccessedAt: now,
        routing: routing || prev.routing,
        ...(isCronSession
          ? {
              sessionType: 'cron',
              customData: {
                ...prev.customData,
                cronJobId: chatId,
              },
            }
          : {}),
        stats: {
          ...prev.stats,
          messageCount: messages.length,
          tokenCount: this.estimateTokens(messages),
          lastTurnAt: Date.now(),
        },
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
        routing,
        ...(isCronSession
          ? {
              sessionType: 'cron',
              customData: { cronJobId: chatId },
            }
          : {}),
        stats: {
          messageCount: messages.length,
          tokenCount: this.estimateTokens(messages),
          lastTurnAt: Date.now(),
        },
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
    
    // Persist the compacted messages to disk so subsequent loads see the reduced context
    await this.saveMessages(key, compacted);
    
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
  async load(key: string, options?: { fromArchive?: boolean }): Promise<AgentMessage[]> {
    return this.loadMessages(key, options);
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
        const body =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content, null, 2);
        lines.push(body);
        lines.push('');
        lines.push('---');
        lines.push('');
      }

      return lines.join('\n');
    }
  }

  // ========== Statistics ==========

  async getStats(): Promise<GlobalSessionStats> {
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
      activeSessions: sessions.filter((s) => s.status === SessionStatus.ACTIVE || s.status === SessionStatus.IDLE).length,
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
    // Reverse of sanitizeKey - restore all colons from underscores
    // telegram_dm_123456 -> telegram:dm:123456
    // telegram_g_-100123456_t_789 -> telegram:g:-100123456:t:789
    return fileName.replace(/_/g, ':');
  }

  private parseSessionKey(key: string): { channel: string; chatId: string } {
    const parts = key.split(':');
    // Session key format: {agentId}:{source}:{accountId}:{peerKind}:{peerId}
    if (parts.length >= 5) {
      return { channel: parts[1], chatId: parts.slice(2).join(':') };
    }
    // ACP session key format: {agentId}:acp:{uuid}
    if (parts.length === 3 && parts[1] === 'acp') {
      return { channel: 'acp', chatId: parts[2] };
    }
    // Cron isolated jobs: `cron:<jobId>` (transcript + metadata under agent sessions dir)
    if (parts.length >= 2 && parts[0] === 'cron') {
      return { channel: 'cron', chatId: parts.slice(1).join(':') };
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
      const parts: string[] = [];
      for (const item of content) {
        if (typeof item !== 'object' || item === null || !('type' in item)) continue;
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

  private convertMessages(messages: AgentMessage[]): Message[] {
    return messages.map((m: any) => {
      const c = m.content;
      const content: string | unknown[] =
        typeof c === 'string'
          ? c
          : Array.isArray(c)
            ? c
            : this.extractTextContent(c);

      const row: Message = {
        role: m.role as 'system' | 'user' | 'assistant' | 'tool' | 'toolResult',
        content,
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
        tool_call_id: m.tool_call_id || m.toolCallId,
        tool_calls: m.tool_calls,
        name: m.name,
      };
      if (Array.isArray(m.attachments) && m.attachments.length > 0) {
        row.attachments = m.attachments;
      }
      return row;
    });
  }

  private async moveToArchive(key: string): Promise<void> {
    const safeKey = this.sanitizeKey(key);
    const sourcePath = join(this.sessionsDir, `${safeKey}.json`);

    // Use timestamped filename to avoid overwriting previous archives
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetPath = join(this.archiveDir, `${safeKey}.${timestamp}.json`);

    try {
      const data = await readFile(sourcePath, 'utf-8');
      await writeFile(targetPath, data);
      await unlink(sourcePath);

      // Move meta file if exists
      const metaSource = join(this.sessionsDir, `${safeKey}.meta.json`);
      const metaTarget = join(this.archiveDir, `${safeKey}.${timestamp}.meta.json`);
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
    const sourcePath = await this.findMostRecentArchive(safeKey);
    if (!sourcePath) {
      return;
    }

    const targetPath = join(this.sessionsDir, `${safeKey}.json`);

    try {
      const data = await readFile(sourcePath, 'utf-8');
      await writeFile(targetPath, data);
      await unlink(sourcePath);

      // Move meta file if exists (find the corresponding meta file)
      const metaSource = sourcePath.replace('.json', '.meta.json');
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
