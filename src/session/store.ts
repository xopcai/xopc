// Session store - manages session persistence, indexing, compaction, and sliding window

import { randomUUID } from 'node:crypto';
import { readFile, mkdir, unlink, readdir, stat, copyFile } from 'fs/promises';
import { basename, join } from 'path';
import { existsSync } from 'fs';
import { writeTextAtomic } from '../infra/write-file-atomic.js';
import { resolveSessionsDir, FILENAMES } from '../config/paths.js';
import { resolveDefaultAgentId } from '../agent/agent-scope.js';
import type { Config } from '../config/schema.js';
import { resolveSessionShardRelativePath } from './shard-path.js';
import { parseSessionKey as parseRoutingSessionKey } from '../routing/session-key.js';
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
  SessionTranscriptSummary,
  CompactionCheckpointSummary,
  CompactionCheckpointDetail,
} from './types.js';
import { SessionStatus } from './types.js';
import type { Message } from './types.js';
import { SessionCompactor, type CompactionConfig, type CompactionResult } from '../agent/memory/compaction.js';
import { SlidingWindow, type WindowConfig } from '../agent/memory/window.js';
import { cleanTrailingErrors, hasProblematicMessages } from '../agent/memory/message-sanitizer.js';
import { invalidateSessionSearchIndexCache } from './search-index-cache.js';
import {
  buildTranscriptEnvelope,
  parseStoredTranscriptJson,
  type TranscriptCompactionRecord,
  type XopcSessionTranscriptV1,
} from './transcript-format.js';
import {
  buildSessionContextForLlm,
  isTranscriptContextEntry,
  mergeLlmMessagesPreservingContextRows,
  type TranscriptStoredRow,
  type XopcTranscriptContextEntry,
} from './session-context-for-llm.js';
import { normalizeCompactionCheckpointId } from './compaction-checkpoints.js';

const log = createLogger('SessionStore');

const INDEX_VERSION = '1.0';
const DEFAULT_LIMIT = 50;
/** Pre-compaction transcript snapshots per session file (same directory as `{safeKey}.json`). */
const MAX_COMPACTION_CHECKPOINTS = 15;

/**
 * Session files live under `resolveSessionsDir(config, agentId)` (ADR-003), sharded by
 * `resolveSessionShardRelativePath(sessionKey)` (users/… vs system/heartbeat; web UI uses
 * compact `users/{agent}/web/{peerId}` for gateway/webchat direct sessions).
 */
export interface SessionStoreOptions {
  /** Loaded app config (required for session path resolution). */
  config: Config;
  /** Agent id for the session store root (default: configured default agent). */
  agentId?: string;
  /** Override storage root (tests); skips `resolveSessionsDir` */
  sessionsDir?: string;
}

export class SessionStore {
  private sessionsDir: string;
  private archiveDir: string;
  private indexFile: string;
  private indexCache: SessionIndex | null = null;
  private indexCacheTime: number = 0;
  private indexDirty = false;
  private window: SlidingWindow;
  private compactor: SessionCompactor;
  /** Serialize index + transcript mutations (reentrant for nested store calls). */
  private storeMutationChain: Promise<void> = Promise.resolve();
  private storeMutationDepth = 0;

  constructor(
    options: SessionStoreOptions,
    windowConfig?: Partial<WindowConfig>,
    compactionConfig?: Partial<CompactionConfig>
  ) {
    const agentId = options.agentId ?? resolveDefaultAgentId(options.config);
    this.sessionsDir = options.sessionsDir ?? resolveSessionsDir(options.config, agentId);
    this.archiveDir = join(this.sessionsDir, 'archive');
    this.indexFile = join(this.sessionsDir, FILENAMES.SESSIONS_INDEX);
    this.window = new SlidingWindow(windowConfig);
    this.compactor = new SessionCompactor(compactionConfig);
  }

  /** Root directory of session JSON files (sharded). Used by `session_search` indexing. */
  getSessionsRoot(): string {
    return this.sessionsDir;
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

    log.debug('Session store initialized');
  }

  private sessionPathsForKey(key: string): { dir: string; jsonPath: string; metaPath: string } {
    const safeKey = this.sanitizeKey(key);
    const shard = resolveSessionShardRelativePath(key);
    const dir = join(this.sessionsDir, shard);
    return {
      dir,
      jsonPath: join(dir, `${safeKey}.json`),
      metaPath: join(dir, `${safeKey}.meta.json`),
    };
  }

  private invalidateIndexCache(): void {
    this.indexCache = null;
    this.indexCacheTime = 0;
  }

  /**
   * Serialize mutations that touch the sessions index or transcript paths.
   * Reentrant: nested calls (e.g. applyCompaction → saveMessages) run inline without deadlocking.
   */
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

  private checkpointBasenamePrefix(safeKey: string): string {
    return `${safeKey}.compaction-backup.`;
  }

  private async pruneCompactionCheckpoints(dir: string, safeKey: string): Promise<void> {
    const prefix = this.checkpointBasenamePrefix(safeKey);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    const candidates = names.filter((n) => n.startsWith(prefix) && n.endsWith('.json'));
    if (candidates.length <= MAX_COMPACTION_CHECKPOINTS) {
      return;
    }
    const stats = await Promise.all(
      candidates.map(async (name) => {
        const p = join(dir, name);
        try {
          const s = await stat(p);
          return { p, mtimeMs: s.mtimeMs };
        } catch {
          return { p, mtimeMs: 0 };
        }
      }),
    );
    stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const removeCount = stats.length - MAX_COMPACTION_CHECKPOINTS;
    for (let i = 0; i < removeCount; i++) {
      try {
        await unlink(stats[i]!.p);
      } catch {
        /* ignore */
      }
    }
  }

  /** Best-effort copy of the current transcript before compaction replaces it. */
  private async captureCompactionCheckpointIfExists(key: string, jsonPath: string): Promise<void> {
    if (!existsSync(jsonPath)) {
      return;
    }
    const safeKey = this.sanitizeKey(key);
    const dir = join(this.sessionsDir, resolveSessionShardRelativePath(key));
    const backupPath = join(dir, `${this.checkpointBasenamePrefix(safeKey)}${randomUUID()}.json`);
    try {
      await copyFile(jsonPath, backupPath);
      await this.pruneCompactionCheckpoints(dir, safeKey);
    } catch (err) {
      log.warn({ err, key, jsonPath }, 'Compaction checkpoint copy failed (continuing)');
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
    await writeTextAtomic(this.indexFile, JSON.stringify(this.indexCache, null, 2));
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
    return this.runStoreMutation(async () => {
      log.info('Rebuilding session index...');

      const sessions: SessionMetadata[] = [];

      // Scan sessions directory
      const files = await this.scanSessionFiles();

      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.meta.json')) {
          const stem = basename(file, '.json');
          if (stem.includes('.compaction-backup.')) {
            continue;
          }
          const key = this.fileNameToKey(stem);
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

      return this.indexCache!;
    });
  }

  private async scanSessionFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      const abs = join(this.sessionsDir, rel);
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const childRel = rel ? join(rel, ent.name) : ent.name;
        if (ent.isDirectory()) {
          if (ent.name === 'archive') continue;
          await walk(childRel);
        } else if (
          ent.name.endsWith('.json') &&
          ent.name !== FILENAMES.SESSIONS_INDEX &&
          !ent.name.endsWith('.meta.json') &&
          !ent.name.includes('.compaction-backup.')
        ) {
          out.push(childRel);
        }
      }
    };
    await walk('');
    return out;
  }

  private normalizeLoadedMessages(messages: AgentMessage[], logCtx?: { key: string }): AgentMessage[] {
    if (hasProblematicMessages(messages)) {
      const cleaned = cleanTrailingErrors(messages);
      if (cleaned.length !== messages.length) {
        log.info(
          { ...logCtx, original: messages.length, cleaned: cleaned.length },
          'Cleaned problematic messages on load',
        );
      }
      return cleaned;
    }
    return messages;
  }

  private async scanSessionFile(key: string): Promise<SessionMetadata | null> {
    const { jsonPath } = this.sessionPathsForKey(key);
    let raw: string;
    try {
      raw = await readFile(jsonPath, 'utf-8');
    } catch {
      return null;
    }
    const { messages: rawMessages, envelope } = parseStoredTranscriptJson(raw);
    const messages = this.normalizeLoadedMessages(rawMessages, { key });
    if (messages.length === 0) return null;

    const stats = await stat(jsonPath);
    const sessionStartedAt = envelope?.createdAt ?? stats.birthtime.toISOString();
    const lastInteractionAt = envelope?.updatedAt ?? stats.mtime.toISOString();

    const { channel, chatId } = this.parseSessionKey(key);
    const routing = this.extractRoutingFromKey(key, channel);
    const isCronSession = channel === 'cron';
    const isHeartbeatSession = channel === 'heartbeat';

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
      ...(envelope?.id ? { transcriptId: envelope.id } : {}),
      sessionStartedAt,
      lastInteractionAt,
      routing,
      ...(isCronSession
        ? {
            sessionType: 'cron',
            customData: { cronJobId: chatId },
          }
        : {}),
      ...(isHeartbeatSession
        ? {
            sessionType: 'heartbeat',
            customData: { heartbeatTarget: chatId },
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
      const channels = query.channel
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (channels.length === 0) {
        sessions = [];
      } else if (channels.length === 1) {
        sessions = sessions.filter((s) => s.sourceChannel === channels[0]);
      } else {
        sessions = sessions.filter((s) => channels.includes(s.sourceChannel));
      }
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

  async get(
    key: string,
    options?: { includeTranscriptSummary?: boolean },
  ): Promise<SessionDetail | null> {
    const metadata = await this.getMetadata(key);
    if (!metadata) return null;

    const messages = await this.loadMessages(key);

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

    return {
      ...metadata,
      messages: this.convertMessages(messages),
      ...(transcriptSummary ? { transcriptSummary } : {}),
    };
  }

  async getMetadata(key: string): Promise<SessionMetadata | null> {
    const index = await this.loadIndex();
    const metadata = index.sessions.find((s) => s.key === key);

    if (!metadata) {
      // Try to load from file directly (orphaned session)
      const scanned = await this.scanSessionFile(key);
      if (!scanned) {
        return null;
      }
      await this.runStoreMutation(async () => {
        this.invalidateIndexCache();
        const fresh = await this.loadIndex();
        if (fresh.sessions.some((s) => s.key === key)) {
          return;
        }
        fresh.sessions.push(scanned);
        this.indexDirty = true;
        await this.saveIndex();
        invalidateSessionSearchIndexCache();
      });
      return scanned;
    }

    return metadata;
  }

  async updateMetadata(key: string, updates: Partial<SessionMetadata>): Promise<void> {
    return this.runStoreMutation(async () => {
      this.invalidateIndexCache();
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
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.runStoreMutation(async () => {
      this.invalidateIndexCache();
      const index = await this.loadIndex();
      const idx = index.sessions.findIndex((s) => s.key === key);

      const primary = this.sessionPathsForKey(key);

      for (const p of [primary.jsonPath]) {
        try {
          await unlink(p);
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
      for (const p of [primary.metaPath]) {
        try {
          await unlink(p);
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }
      }

      // Remove from index
      if (idx !== -1) {
        index.sessions.splice(idx, 1);
        this.indexDirty = true;
        await this.saveIndex();
      }

      log.info({ key }, 'Session deleted');
      return true;
    });
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
    const primary = this.sessionPathsForKey(key);

    const readAndNormalize = async (path: string): Promise<AgentMessage[] | null> => {
      try {
        const data = await readFile(path, 'utf-8');
        const { messages } = parseStoredTranscriptJson(data);
        return this.normalizeLoadedMessages(messages, { key });
      } catch {
        return null;
      }
    };

    const messages = await readAndNormalize(primary.jsonPath);

    if (messages !== null) {
      return messages;
    }

    if (options?.fromArchive) {
      const archivedFile = await this.findMostRecentArchive(key);
      if (!archivedFile) {
        return [];
      }
      const archived = await readAndNormalize(archivedFile);
      return archived ?? [];
    }
    return [];
  }

  /**
   * Load the versioned transcript document (stable id, compaction history) if the on-disk file uses the wrapped format.
   * Legacy bare-array transcripts return null.
   */
  async loadTranscriptDocument(key: string): Promise<XopcSessionTranscriptV1 | null> {
    const { jsonPath } = this.sessionPathsForKey(key);
    try {
      const raw = await readFile(jsonPath, 'utf-8');
      return parseStoredTranscriptJson(raw).envelope;
    } catch {
      return null;
    }
  }

  /**
   * Find the most recent archived session file for a given key.
   * Archived files have format: {safeKey}.{timestamp}.json
   */
  private async findMostRecentArchive(sessionKey: string): Promise<string | null> {
    const safeKey = this.sanitizeKey(sessionKey);
    const shardDir = join(this.archiveDir, resolveSessionShardRelativePath(sessionKey));

    const scanDir = async (dir: string): Promise<string | null> => {
      try {
        const files = await readdir(dir);
        const matchingFiles = files
          .filter(
            (f) =>
              f.startsWith(`${safeKey}.`) &&
              f.endsWith('.json') &&
              !f.endsWith('.meta.json') &&
              !f.includes('.compaction-backup.'),
          )
          .sort()
          .reverse();
        if (matchingFiles.length === 0) return null;
        return join(dir, matchingFiles[0]);
      } catch {
        return null;
      }
    };

    const inShard = await scanDir(shardDir);
    if (inShard) return inShard;
    return await scanDir(this.archiveDir);
  }

  /**
   * Persist transcript JSON + merge session row into the index. Caller must hold {@link runStoreMutation} (or be nested under it).
   * Transcript is stored as a versioned document (pi-style header) with stable {@link XopcSessionTranscriptV1.id}.
   */
  private async writeSessionTranscriptFromStoredRows(
    key: string,
    storedRows: TranscriptStoredRow[],
    options?: { appendCompaction?: TranscriptCompactionRecord },
  ): Promise<void> {
    const { dir, jsonPath } = this.sessionPathsForKey(key);

    await mkdir(dir, { recursive: true });

    let previous: XopcSessionTranscriptV1 | null = null;
    try {
      const raw = await readFile(jsonPath, 'utf-8');
      previous = parseStoredTranscriptJson(raw).envelope;
    } catch {
      /* new session or unreadable */
    }

    const doc = buildTranscriptEnvelope({
      storedRows,
      previous,
      appendCompaction: options?.appendCompaction,
    });
    await writeTextAtomic(jsonPath, JSON.stringify(doc, null, 2));

    const llmMessages = buildSessionContextForLlm(storedRows);
    const index = await this.loadIndex();
    const existingIdx = index.sessions.findIndex((s) => s.key === key);
    const now = new Date().toISOString();

    const { channel, chatId } = this.parseSessionKey(key);
    const routing = this.extractRoutingFromKey(key, channel);
    const isCronSession = channel === 'cron';
    const isHeartbeatSession = channel === 'heartbeat';

    if (existingIdx !== -1) {
      const prev = index.sessions[existingIdx];
      index.sessions[existingIdx] = {
        ...prev,
        sourceChannel: channel,
        sourceChatId: chatId,
        messageCount: llmMessages.length,
        estimatedTokens: this.estimateTokens(llmMessages),
        updatedAt: now,
        lastAccessedAt: now,
        transcriptId: doc.id,
        sessionStartedAt: prev.sessionStartedAt ?? doc.createdAt,
        lastInteractionAt: now,
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
        ...(isHeartbeatSession
          ? {
              sessionType: 'heartbeat',
              customData: {
                ...prev.customData,
                heartbeatTarget: chatId,
              },
            }
          : {}),
        stats: {
          ...prev.stats,
          messageCount: llmMessages.length,
          tokenCount: this.estimateTokens(llmMessages),
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
        transcriptId: doc.id,
        sessionStartedAt: doc.createdAt,
        lastInteractionAt: now,
        messageCount: llmMessages.length,
        estimatedTokens: this.estimateTokens(llmMessages),
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
        ...(isHeartbeatSession
          ? {
              sessionType: 'heartbeat',
              customData: { heartbeatTarget: chatId },
            }
          : {}),
        stats: {
          messageCount: llmMessages.length,
          tokenCount: this.estimateTokens(llmMessages),
          lastTurnAt: Date.now(),
        },
      });
    }

    this.indexDirty = true;
    await this.saveIndex();

    invalidateSessionSearchIndexCache();
  }

  private async writeSessionTranscriptAndUpdateIndex(
    key: string,
    messages: AgentMessage[],
    options?: { appendCompaction?: TranscriptCompactionRecord },
  ): Promise<void> {
    const { jsonPath } = this.sessionPathsForKey(key);
    let storedRows: TranscriptStoredRow[] = messages;
    try {
      const raw = await readFile(jsonPath, 'utf-8');
      const parsed = parseStoredTranscriptJson(raw);
      if (parsed.rows.some((r) => isTranscriptContextEntry(r))) {
        storedRows = mergeLlmMessagesPreservingContextRows(parsed.rows, messages);
      }
    } catch {
      /* new session or unreadable */
    }
    await this.writeSessionTranscriptFromStoredRows(key, storedRows, options);
  }

  /**
   * Append a persisted-only transcript row (`kind: 'context'`), visible on disk and in session search
   * after stripping, but never returned from {@link loadMessages}.
   */
  async appendTranscriptContextEntry(
    key: string,
    entry: Omit<XopcTranscriptContextEntry, 'kind'> & Partial<Pick<XopcTranscriptContextEntry, 'kind'>>,
  ): Promise<void> {
    return this.runStoreMutation(async () => {
      this.invalidateIndexCache();
      const { jsonPath } = this.sessionPathsForKey(key);
      let rows: TranscriptStoredRow[] = [];
      try {
        const raw = await readFile(jsonPath, 'utf-8');
        rows = parseStoredTranscriptJson(raw).rows;
      } catch {
        /* new file */
      }
      const row: XopcTranscriptContextEntry = {
        kind: 'context',
        id: typeof entry.id === 'string' ? entry.id : undefined,
        text: typeof entry.text === 'string' ? entry.text : undefined,
        data: entry.data,
        createdAt: entry.createdAt ?? new Date().toISOString(),
      };
      await this.writeSessionTranscriptFromStoredRows(key, [...rows, row], {});
    });
  }

  async saveMessages(key: string, messages: AgentMessage[]): Promise<void> {
    return this.runStoreMutation(async () => {
      this.invalidateIndexCache();
      await this.writeSessionTranscriptAndUpdateIndex(key, messages);
    });
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

    return this.runStoreMutation(async () => {
      this.invalidateIndexCache();
      const { jsonPath } = this.sessionPathsForKey(key);
      await this.captureCompactionCheckpointIfExists(key, jsonPath);

      await this.writeSessionTranscriptAndUpdateIndex(key, compacted, {
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
        await this.updateMetadata(key, {
          compactedCount: metadata.compactedCount + 1,
        });
      }

      log.info(
        {
          key,
          tokensBefore: result.tokensBefore,
          tokensAfter: result.tokensAfter,
          keptMessages: compacted.length,
        },
        'Session compacted',
      );

      return compacted;
    });
  }

  /**
   * Compact session with LLM summary
   */
  async compact(
    key: string,
    messages: AgentMessage[],
    contextWindow: number,
    instructions?: string,
    force?: boolean,
  ): Promise<CompactionResult> {
    const result = await this.compactor.compact(messages, instructions, force);
    
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

  /**
   * List pre-compaction transcript snapshots for a session (newest first).
   */
  async listCompactionCheckpoints(key: string): Promise<CompactionCheckpointSummary[]> {
    const safeKey = this.sanitizeKey(key);
    const dir = join(this.sessionsDir, resolveSessionShardRelativePath(key));
    const prefix = this.checkpointBasenamePrefix(safeKey);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const files = names.filter((n) => n.startsWith(prefix) && n.endsWith('.json'));
    const rows = await Promise.all(
      files.map(async (name) => {
        const p = join(dir, name);
        try {
          const s = await stat(p);
          const id = name.slice(prefix.length, -'.json'.length);
          if (!normalizeCompactionCheckpointId(id)) {
            return null;
          }
          return {
            id: normalizeCompactionCheckpointId(id)!,
            sizeBytes: s.size,
            modifiedAt: new Date(s.mtimeMs).toISOString(),
          } satisfies CompactionCheckpointSummary;
        } catch {
          return null;
        }
      }),
    );
    const valid = rows.filter((r): r is CompactionCheckpointSummary => r !== null);
    valid.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return valid;
  }

  /**
   * Metadata for a single compaction checkpoint file.
   */
  async getCompactionCheckpointDetail(
    key: string,
    checkpointId: string,
  ): Promise<CompactionCheckpointDetail | null> {
    const id = normalizeCompactionCheckpointId(checkpointId);
    if (!id) {
      return null;
    }
    const safeKey = this.sanitizeKey(key);
    const dir = join(this.sessionsDir, resolveSessionShardRelativePath(key));
    const fname = `${this.checkpointBasenamePrefix(safeKey)}${id}.json`;
    const cpPath = join(dir, fname);
    if (!existsSync(cpPath)) {
      return null;
    }
    try {
      const raw = await readFile(cpPath, 'utf-8');
      const { messages } = parseStoredTranscriptJson(raw);
      const norm = this.normalizeLoadedMessages(messages, { key });
      const s = await stat(cpPath);
      return {
        id,
        sizeBytes: s.size,
        modifiedAt: new Date(s.mtimeMs).toISOString(),
        messageCount: norm.length,
      };
    } catch {
      return null;
    }
  }

  /**
   * Restore main transcript from a pre-compaction snapshot (then re-wrap + index sync).
   * Does not delete the checkpoint file.
   */
  async restoreCompactionCheckpoint(key: string, checkpointId: string): Promise<void> {
    const id = normalizeCompactionCheckpointId(checkpointId);
    if (!id) {
      throw new Error('Invalid checkpoint id');
    }
    return this.runStoreMutation(async () => {
      const safeKey = this.sanitizeKey(key);
      const dir = join(this.sessionsDir, resolveSessionShardRelativePath(key));
      const fname = `${this.checkpointBasenamePrefix(safeKey)}${id}.json`;
      const cpPath = join(dir, fname);
      if (!existsSync(cpPath)) {
        throw new Error(`Checkpoint not found: ${id}`);
      }
      const { jsonPath } = this.sessionPathsForKey(key);
      await copyFile(cpPath, jsonPath);
      const messages = await this.loadMessages(key);
      await this.writeSessionTranscriptAndUpdateIndex(key, messages);
      log.info({ key, checkpointId: id }, 'Session transcript restored from compaction checkpoint');
    });
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
      const parsed = parseRoutingSessionKey(key);
      if (parsed?.source === 'cron') {
        return { channel: 'cron', chatId: parsed.peerId };
      }
      return { channel: parts[1], chatId: parts.slice(2).join(':') };
    }
    // Gateway heartbeat: `heartbeat:main` / `heartbeat:isolated:<ts>`
    if (parts.length >= 2 && parts[0] === 'heartbeat') {
      return { channel: 'heartbeat', chatId: parts.slice(1).join(':') };
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
    return this.runStoreMutation(async () => {
      const safeKey = this.sanitizeKey(key);
      const primary = this.sessionPathsForKey(key);
      const sourcePath = existsSync(primary.jsonPath) ? primary.jsonPath : null;
      if (!sourcePath) {
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveShard = join(this.archiveDir, resolveSessionShardRelativePath(key));
      await mkdir(archiveShard, { recursive: true });
      const targetPath = join(archiveShard, `${safeKey}.${timestamp}.json`);

      try {
        const data = await readFile(sourcePath, 'utf-8');
        await writeTextAtomic(targetPath, data);
        await unlink(sourcePath);

        const metaSource = primary.metaPath;
        const metaTarget = join(archiveShard, `${safeKey}.${timestamp}.meta.json`);
        try {
          const metaData = await readFile(metaSource, 'utf-8');
          await writeTextAtomic(metaTarget, metaData);
          await unlink(metaSource);
        } catch {
          // Meta file might not exist
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    });
  }

  private async moveFromArchive(key: string): Promise<void> {
    return this.runStoreMutation(async () => {
      const sourcePath = await this.findMostRecentArchive(key);
      if (!sourcePath) {
        return;
      }

      const primary = this.sessionPathsForKey(key);
      await mkdir(primary.dir, { recursive: true });
      const targetPath = primary.jsonPath;

      try {
        const data = await readFile(sourcePath, 'utf-8');
        await writeTextAtomic(targetPath, data);
        await unlink(sourcePath);

        const metaSource = sourcePath.replace('.json', '.meta.json');
        const metaTarget = primary.metaPath;
        try {
          const metaData = await readFile(metaSource, 'utf-8');
          await writeTextAtomic(metaTarget, metaData);
          await unlink(metaSource);
        } catch {
          // Meta file might not exist
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    });
  }

}
