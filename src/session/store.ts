import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { CompactionEntry } from '@earendil-works/pi-coding-agent';

import { loadEntriesFromFile } from './parity/load-jsonl-entries.js';

import type { Config } from '../config/schema.js';
import { resolveSessionsDir, FILENAMES } from '../config/paths.js';
import { resolveDefaultAgentId, listAgentEntries } from '../agent/agent-scope.js';
import { resolveEffectiveAgentProfileForSession } from '../config/agent-profile.js';
import { readPostCompactionContext } from '../agent/reply/post-compaction-context.js';
import { parseSessionKey as parseRoutingSessionKey } from '../routing/session-key.js';
import { createLogger } from '../utils/logger.js';
import { SessionCompactor, type CompactionConfig, type CompactionResult } from '../agent/memory/compaction.js';
import { SlidingWindow, type WindowConfig } from '../agent/memory/window.js';
import { invalidateSessionSearchIndexCache } from './search-index-cache.js';
import type { TranscriptCompactionRecord, XopcSessionTranscriptV1 } from './transcript-format.js';
import {
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
import { parseCompactionCheckpointTranscriptFileName } from './parity/artifacts.js';
import { archiveFileOnDisk, resolveSessionFilePath, resolveSessionTranscriptPathInDir } from './parity/transcript-paths.js';
import { validateSessionId } from './parity/session-id.js';
import { readSessionsJsonFile, withSessionsJsonLock } from './parity/sessions-json-file.js';
import type { XopcSessionDiskEntry } from './parity/xopc-session-disk-entry.js';
import {
  appendPiTranscriptContextEntry,
  persistMergedTranscriptRows,
  readTranscriptRowsFromFile,
  rowsToLlmMessages,
  writeTranscriptJsonl,
} from './parity/jsonl-transcript-io.js';
import type { SessionTranscriptUpdate } from './transcript-events.js';

const log = createLogger('SessionStore');

const INDEX_VERSION = '1.0';
const DELETED_MARKER = '.jsonl.deleted.';

export interface SessionStoreOptions {
  config: Config;
  agentId?: string;
  sessionsDir?: string;
}

export class SessionStore {
  private sessionsDir: string;
  private archiveDir: string;
  private storePath: string;
  private window: SlidingWindow;
  private compactor: SessionCompactor;
  private storeMutationDepth = 0;
  private storeMutationChain: Promise<void> = Promise.resolve();
  /** Cache of per-agent sessions dirs to avoid re-resolution on every call. */
  private agentSessionsDirCache = new Map<string, string>();

  constructor(
    private options: SessionStoreOptions,
    windowConfig?: Partial<WindowConfig>,
    compactionConfig?: Partial<CompactionConfig>,
  ) {
    const agentId = options.agentId ?? resolveDefaultAgentId(options.config);
    this.sessionsDir = options.sessionsDir ?? resolveSessionsDir(options.config, agentId);
    this.archiveDir = join(this.sessionsDir, 'archive');
    this.storePath = join(this.sessionsDir, FILENAMES.SESSIONS_MAP);
    this.window = new SlidingWindow(windowConfig);
    this.compactor = new SessionCompactor(compactionConfig);
  }

  getSessionsRoot(): string {
    return this.sessionsDir;
  }

  /**
   * OpenClaw-aligned: resolve the sessions directory for a given session key.
   * Extracts agentId from the session key and routes to `agents/<agentId>/sessions/`.
   * Falls back to the default sessions directory when agentId cannot be parsed
   * or when `sessionsDir` was explicitly provided in options.
   */
  private resolveSessionsDirForKey(sessionKey: string): string {
    if (this.options.sessionsDir) {
      return this.sessionsDir;
    }
    const parsed = parseRoutingSessionKey(sessionKey);
    if (!parsed) {
      return this.sessionsDir;
    }
    const agentId = parsed.agentId;
    const cached = this.agentSessionsDirCache.get(agentId);
    if (cached) {
      return cached;
    }
    const resolved = resolveSessionsDir(this.options.config, agentId);
    this.agentSessionsDirCache.set(agentId, resolved);
    return resolved;
  }

  private resolveStorePathForKey(sessionKey: string): string {
    return join(this.resolveSessionsDirForKey(sessionKey), FILENAMES.SESSIONS_MAP);
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
    await mkdir(this.sessionsDir, { recursive: true });
    await mkdir(this.archiveDir, { recursive: true });
    if (!existsSync(this.storePath)) {
      await withSessionsJsonLock(this.storePath, async () => undefined);
    }
    log.debug('Session store initialized (sessions.json + JSONL)');
  }

  private transcriptPathForEntry(entry: XopcSessionDiskEntry, sessionsDir?: string): string {
    return resolveSessionFilePath(entry.sessionId, entry, { sessionsDir: sessionsDir ?? this.sessionsDir });
  }

  private async readMapForKey(sessionKey: string): Promise<Record<string, XopcSessionDiskEntry>> {
    const storePath = this.resolveStorePathForKey(sessionKey);
    return readSessionsJsonFile<XopcSessionDiskEntry>(storePath);
  }

  private async readMap(): Promise<Record<string, XopcSessionDiskEntry>> {
    return readSessionsJsonFile<XopcSessionDiskEntry>(this.storePath);
  }

  /**
   * OpenClaw-aligned: read sessions.json from ALL known agents and merge into a single map.
   * Used by aggregation queries (list, getByAgent, getByAccount, etc.) so the gateway UI
   * can display sessions across all agents.
   */
  private async readAllMaps(): Promise<Record<string, XopcSessionDiskEntry>> {
    if (this.options.sessionsDir) {
      return this.readMap();
    }
    const agents = listAgentEntries(this.options.config);
    const defaultId = resolveDefaultAgentId(this.options.config);
    const agentIds = new Set<string>([defaultId, ...agents.map((a) => a.id)]);

    const merged: Record<string, XopcSessionDiskEntry> = {};
    for (const id of agentIds) {
      const dir = resolveSessionsDir(this.options.config, id);
      const path = join(dir, FILENAMES.SESSIONS_MAP);
      if (!existsSync(path)) {
        continue;
      }
      const map = await readSessionsJsonFile<XopcSessionDiskEntry>(path);
      Object.assign(merged, map);
    }
    return merged;
  }

  private async getDiskEntry(sessionKey: string): Promise<XopcSessionDiskEntry | undefined> {
    const map = await this.readMapForKey(sessionKey);
    return map[sessionKey];
  }

  private buildDefaultMetadata(key: string): SessionMetadata {
    const { channel, chatId } = this.parseSessionKey(key);
    const routing = this.extractRoutingFromKey(key);
    const isCronSession = channel === 'cron';
    const isHeartbeatSession = channel === 'heartbeat';
    const now = new Date().toISOString();
    return {
      key,
      status: SessionStatus.ACTIVE,
      tags: [],
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      messageCount: 0,
      estimatedTokens: 0,
      compactedCount: 0,
      sourceChannel: channel,
      sourceChatId: chatId,
      routing,
      ...(isCronSession
        ? { sessionType: 'cron', customData: { cronJobId: chatId } }
        : {}),
      ...(isHeartbeatSession
        ? { sessionType: 'heartbeat', customData: { heartbeatTarget: chatId } }
        : {}),
      stats: { messageCount: 0, tokenCount: 0 },
    };
  }

  private parseSessionKey(key: string): { channel: string; chatId: string } {
    const parts = key.split(':');
    if (parts.length >= 2 && parts[0] === 'heartbeat') {
      return { channel: 'heartbeat', chatId: parts.slice(1).join(':') };
    }
    const parsed = parseRoutingSessionKey(key);
    if (parsed) {
      if (parsed.source === 'cron') {
        return { channel: 'cron', chatId: parsed.peerId };
      }
      return {
        channel: parsed.source,
        chatId: [parsed.accountId, parsed.peerKind, parsed.peerId].join(':'),
      };
    }
    return { channel: 'unknown', chatId: key };
  }

  private extractRoutingFromKey(key: string): SessionMetadata['routing'] {
    const parsed = parseRoutingSessionKey(key);
    if (!parsed) {
      return undefined;
    }
    return {
      agentId: parsed.agentId?.toLowerCase() || 'main',
      source: parsed.source?.toLowerCase() || 'unknown',
      accountId: parsed.accountId?.toLowerCase() || 'default',
      peerKind: parsed.peerKind?.toLowerCase() || 'dm',
      peerId: parsed.peerId?.toLowerCase() || 'unknown',
      threadId: parsed.threadId,
      scopeId: parsed.scopeId,
    };
  }

  /** Resolve on-disk transcript path; creates session row + empty JSONL when missing. */
  async resolveTranscriptPath(
    sessionKey: string,
  ): Promise<{ sessionId: string; absPath: string; sessionsDir: string }> {
    const entry = await this.ensureSession(sessionKey);
    const sessionsDir = this.resolveSessionsDirForKey(sessionKey);
    const absPath = this.transcriptPathForEntry(entry, sessionsDir);
    return { sessionId: entry.sessionId, absPath, sessionsDir };
  }

  /** Ensure sessions.json has an entry and transcript file exist for `sessionKey`. */
  private async ensureSession(sessionKey: string): Promise<XopcSessionDiskEntry> {
    const keyStorePath = this.resolveStorePathForKey(sessionKey);
    const keySessionsDir = this.resolveSessionsDirForKey(sessionKey);
    await mkdir(keySessionsDir, { recursive: true });
    return withSessionsJsonLock(keyStorePath, async (map) => {
      const existing = map[sessionKey] as XopcSessionDiskEntry | undefined;
      if (existing?.pluginExtensions?.xopc?.metadata) {
        return existing;
      }
      let entry = existing;
      if (!entry) {
        const sessionId = randomUUID();
        validateSessionId(sessionId);
        const sessionFile = `${sessionId}.jsonl`;
        const now = Date.now();
        const metadata = this.buildDefaultMetadata(sessionKey);
        metadata.transcriptId = sessionId;
        entry = {
          sessionId,
          updatedAt: now,
          sessionStartedAt: now,
          sessionFile,
          pluginExtensions: { xopc: { metadata } },
        };
        map[sessionKey] = entry as Record<string, unknown>;
        const abs = resolveSessionTranscriptPathInDir(sessionId, keySessionsDir);
        await writeTranscriptJsonl({
          absPath: abs,
          sessionId,
          cwd: process.cwd(),
          rows: [],
        });
      } else if (!entry.pluginExtensions?.xopc?.metadata) {
        const metadata = this.buildDefaultMetadata(sessionKey);
        metadata.transcriptId = entry.sessionId;
        entry.pluginExtensions = { xopc: { metadata } };
        map[sessionKey] = entry as Record<string, unknown>;
      }
      return entry!;
    });
  }

  private metadataFromEntry(sessionKey: string, entry: XopcSessionDiskEntry): SessionMetadata {
    const base = entry.pluginExtensions?.xopc?.metadata ?? this.buildDefaultMetadata(sessionKey);
    const { channel: keySource, chatId: keyChatId } = this.parseSessionKey(sessionKey);
    const diskSc = typeof base.sourceChannel === 'string' ? base.sourceChannel.trim() : '';
    const diskChat = typeof base.sourceChatId === 'string' ? base.sourceChatId.trim() : '';
    return {
      ...base,
      key: sessionKey,
      transcriptId: entry.sessionId,
      sourceChannel: diskSc || keySource,
      sourceChatId: diskChat || keyChatId,
    };
  }

  async getByAgent(agentId: string): Promise<SessionMetadata[]> {
    const map = await this.readAllMaps();
    const out: SessionMetadata[] = [];
    for (const [key, e] of Object.entries(map)) {
      const m = this.metadataFromEntry(key, e);
      if (m.routing?.agentId?.toLowerCase() === agentId.toLowerCase()) {
        out.push(m);
      }
    }
    return out;
  }

  async getByAccount(accountId: string): Promise<SessionMetadata[]> {
    const map = await this.readAllMaps();
    const out: SessionMetadata[] = [];
    for (const [key, e] of Object.entries(map)) {
      const m = this.metadataFromEntry(key, e);
      if (m.routing?.accountId === accountId) {
        out.push(m);
      }
    }
    return out;
  }

  async getByPeer(peerKind: string, peerId: string): Promise<SessionMetadata[]> {
    const map = await this.readAllMaps();
    const out: SessionMetadata[] = [];
    for (const [key, e] of Object.entries(map)) {
      const m = this.metadataFromEntry(key, e);
      if (m.routing?.peerKind === peerKind && m.routing.peerId === peerId) {
        out.push(m);
      }
    }
    return out;
  }

  async getMainSession(channel: string, accountId: string): Promise<SessionMetadata | null> {
    const map = await this.readAllMaps();
    for (const [key, e] of Object.entries(map)) {
      const m = this.metadataFromEntry(key, e);
      if (
        m.routing?.source === channel &&
        m.routing.accountId === accountId &&
        m.routing.peerKind === 'dm' &&
        m.routing.peerId === 'main'
      ) {
        return m;
      }
    }
    return null;
  }

  async refreshIndex(): Promise<void> {
    /* no-op: sessions.json is authoritative */
  }

  async list(query: SessionListQuery = {}): Promise<PaginatedResult<SessionMetadata>> {
    const map = await this.readAllMaps();
    let sessions = Object.entries(map).map(([k, e]) => this.metadataFromEntry(k, e));

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      sessions = sessions.filter((s) => statuses.includes(s.status));
    }
    if (query.channel) {
      const rawChannels = query.channel
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      /**
       * `ui` is a legacy console source; treat as webchat when filtering web sessions.
       * `webui` matches slash-command normalization to `gateway` (see `chat-commands/session-key.ts`).
       */
      const channels = [
        ...new Set(
          rawChannels.flatMap((c) => {
            if (c === 'webchat') return ['webchat', 'ui'];
            if (c === 'gateway') return ['gateway', 'webui'];
            return [c];
          }),
        ),
      ];
      if (channels.length === 0) {
        sessions = [];
      } else if (channels.length === 1) {
        const ch = channels[0]!;
        sessions = sessions.filter((s) => (s.sourceChannel ?? '').toLowerCase() === ch);
      } else {
        sessions = sessions.filter((s) => channels.includes((s.sourceChannel ?? '').toLowerCase()));
      }
    }
    if (query.tags?.length) {
      sessions = sessions.filter((s) => query.tags!.some((t) => s.tags.includes(t)));
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      sessions = sessions.filter(
        (s) =>
          s.key.toLowerCase().includes(q) ||
          (s.name?.toLowerCase().includes(q) ?? false) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    const sortBy = query.sortBy || 'updatedAt';
    const sortOrder = query.sortOrder || 'desc';
    sessions.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      return sortOrder === 'asc' ? c : -c;
    });

    const total = sessions.length;
    const limit = query.limit || 50;
    const offset = query.offset || 0;
    const items = sessions.slice(offset, offset + limit);
    return { items, total, limit, offset, hasMore: offset + limit < total };
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
    const detail = await this.buildSessionDetail(key, metadata, messages, options);
    return detail;
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
    const messages = await this.loadDisplayMessages(key);
    const total = messages.length;
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const parsedBefore = options.before ? Number.parseInt(options.before, 10) : undefined;
    const hasBeforeCursor = parsedBefore !== undefined && Number.isFinite(parsedBefore);
    const endExclusive = hasBeforeCursor
      ? Math.min(total, Math.max(0, Math.trunc(parsedBefore)))
      : Math.max(0, total - offset);
    const startInclusive = Math.max(0, endExclusive - limit);
    const pageMessages = messages.slice(startInclusive, endExclusive);
    const session = await this.buildSessionDetail(key, metadata, pageMessages, options);
    const nextBeforeCursor = startInclusive > 0 ? String(startInclusive) : undefined;

    return {
      session,
      pagination: {
        total,
        limit,
        offset,
        hasMore: startInclusive > 0,
        ...(hasBeforeCursor ? { before: String(endExclusive) } : {}),
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
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return [];
    }
    const path = this.transcriptPathForEntry(entry, this.resolveSessionsDirForKey(key));
    return readTranscriptRowsFromFile(path);
  }

  async getMetadata(key: string): Promise<SessionMetadata | null> {
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return null;
    }
    return this.metadataFromEntry(key, entry);
  }

  async updateMetadata(key: string, updates: Partial<SessionMetadata>): Promise<void> {
    return this.runStoreMutation(async () => {
      const keyStorePath = this.resolveStorePathForKey(key);
      await withSessionsJsonLock(keyStorePath, async (map) => {
        const entry = map[key] as XopcSessionDiskEntry | undefined;
        if (!entry?.pluginExtensions?.xopc?.metadata) {
          throw new Error(`Session not found: ${key}`);
        }
        const meta = { ...entry.pluginExtensions.xopc.metadata, ...updates, updatedAt: new Date().toISOString() };
        entry.pluginExtensions.xopc.metadata = meta;
        entry.updatedAt = Date.now();
        map[key] = entry as Record<string, unknown>;
      });
      invalidateSessionSearchIndexCache();
      log.debug({ key, updates }, 'Session metadata updated');
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.runStoreMutation(async () => {
      const entry = await this.getDiskEntry(key);
      if (!entry) {
        return false;
      }
      const keySessionsDir = this.resolveSessionsDirForKey(key);
      const abs = this.transcriptPathForEntry(entry, keySessionsDir);
      const keyStorePath = this.resolveStorePathForKey(key);
      await withSessionsJsonLock(keyStorePath, async (map) => {
        delete map[key];
      });
      try {
        if (existsSync(abs)) {
          archiveFileOnDisk(abs, 'deleted');
        }
      } catch (err) {
        log.warn({ err, key }, 'Transcript archive on delete failed');
      }
      invalidateSessionSearchIndexCache();
      log.info({ key }, 'Session deleted');
      return true;
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

  private async moveToArchive(key: string): Promise<void> {
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return;
    }
    const keySessionsDir = this.resolveSessionsDirForKey(key);
    const abs = this.transcriptPathForEntry(entry, keySessionsDir);
    if (existsSync(abs)) {
      try {
        archiveFileOnDisk(abs, 'deleted');
      } catch (err) {
        log.warn({ err, key }, 'Archive transcript rename failed');
      }
    }
  }

  private async findMostRecentDeletedTranscript(sessionId: string, sessionsDir: string): Promise<string | null> {
    let names: string[];
    try {
      names = await readdir(sessionsDir);
    } catch {
      return null;
    }
    const prefix = `${sessionId}${DELETED_MARKER}`;
    const hits = names.filter((n) => n.startsWith(prefix) && n.endsWith('Z'));
    hits.sort().reverse();
    const first = hits[0];
    return first ? join(sessionsDir, first) : null;
  }

  private async moveFromArchive(key: string): Promise<void> {
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return;
    }
    const keySessionsDir = this.resolveSessionsDirForKey(key);
    const target = resolveSessionTranscriptPathInDir(entry.sessionId, keySessionsDir);
    if (existsSync(target)) {
      return;
    }
    const src = await this.findMostRecentDeletedTranscript(entry.sessionId, keySessionsDir);
    if (!src) {
      return;
    }
    try {
      const { rename } = await import('fs/promises');
      await rename(src, target);
    } catch (err) {
      log.warn({ err, key, src, target }, 'Unarchive transcript rename failed');
    }
  }

  async loadMessages(key: string, options?: { fromArchive?: boolean }): Promise<AgentMessage[]> {
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return [];
    }
    const keySessionsDir = this.resolveSessionsDirForKey(key);
    const primary = this.transcriptPathForEntry(entry, keySessionsDir);
    if (existsSync(primary)) {
      const rows = await readTranscriptRowsFromFile(primary);
      return rowsToLlmMessages(rows);
    }
    if (options?.fromArchive) {
      const archived = await this.findMostRecentDeletedTranscript(entry.sessionId, keySessionsDir);
      if (!archived) {
        return [];
      }
      const rows = await readTranscriptRowsFromFile(archived);
      return rowsToLlmMessages(rows);
    }
    return [];
  }

  private async loadDisplayMessages(key: string): Promise<AgentMessage[]> {
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return [];
    }
    const keySessionsDir = this.resolveSessionsDirForKey(key);
    const primary = this.transcriptPathForEntry(entry, keySessionsDir);
    const transcriptPaths: string[] = [];
    const checkpoints = await this.listCompactionCheckpoints(key);
    for (const checkpoint of [...checkpoints].reverse()) {
      transcriptPaths.push(join(keySessionsDir, `${this.checkpointBasename(entry.sessionId)}${checkpoint.id}.jsonl`));
    }
    transcriptPaths.push(primary);

    const messages: AgentMessage[] = [];
    const seenMessages = new Set<string>();
    for (const transcriptPath of transcriptPaths) {
      if (!existsSync(transcriptPath)) {
        continue;
      }
      const rows = await readTranscriptRowsFromFile(transcriptPath);
      for (const message of rowsToLlmMessages(rows)) {
        if (this.isCompactionSummaryMessage(message)) {
          continue;
        }
        const key = this.displayMessageIdentity(message);
        if (seenMessages.has(key)) {
          continue;
        }
        seenMessages.add(key);
        messages.push(message);
      }
    }
    return messages;
  }

  async loadTranscriptDocument(key: string): Promise<XopcSessionTranscriptV1 | null> {
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return null;
    }
    const path = this.transcriptPathForEntry(entry, this.resolveSessionsDirForKey(key));
    if (!existsSync(path)) {
      return null;
    }
    const entries = loadEntriesFromFile(path);
    const header = entries.find((e) => e.type === 'session');
    if (!header || typeof (header as { id?: unknown }).id !== 'string') {
      return null;
    }
    const sessionHeader = header as { type: 'session'; id: string; timestamp?: string };
    const rows = await readTranscriptRowsFromFile(path);
    const compactions = entries
      .filter((e): e is CompactionEntry => e.type === 'compaction')
      .map((c) => ({
        at: c.timestamp,
        summary: c.summary,
        firstKeptIndex: Number.parseInt(String(c.firstKeptEntryId), 10) || 0,
        tokensBefore: c.tokensBefore,
        tokensAfter:
          typeof c.details === 'object' &&
          c.details &&
          'tokensAfter' in c.details &&
          typeof (c.details as { tokensAfter?: unknown }).tokensAfter === 'number'
            ? (c.details as { tokensAfter: number }).tokensAfter
            : 0,
      }));
    return {
      type: 'xopc_session_transcript',
      version: 1,
      id: sessionHeader.id,
      createdAt: sessionHeader.timestamp ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: rows,
      ...(compactions.length > 0 ? { compactions } : {}),
    };
  }

  private async writeTranscriptAndSyncIndex(
    key: string,
    rows: TranscriptStoredRow[],
    opts?: { appendCompaction?: TranscriptCompactionRecord },
  ): Promise<void> {
    const entry = await this.ensureSession(key);
    const keySessionsDir = this.resolveSessionsDirForKey(key);
    const abs = this.transcriptPathForEntry(entry, keySessionsDir);
    const llm = rowsToLlmMessages(rows);
    const now = Date.now();
    await persistMergedTranscriptRows({
      absPath: abs,
      sessionId: entry.sessionId,
      cwd: process.cwd(),
      rows,
      appendCompaction: opts?.appendCompaction,
    });
    const keyStorePath = this.resolveStorePathForKey(key);
    await withSessionsJsonLock(keyStorePath, async (map) => {
      const e = map[key] as XopcSessionDiskEntry | undefined;
      if (!e?.pluginExtensions?.xopc?.metadata) {
        return;
      }
      const meta = e.pluginExtensions.xopc.metadata;
      meta.messageCount = llm.length;
      meta.estimatedTokens = this.estimateTokens(llm);
      meta.updatedAt = new Date().toISOString();
      meta.lastAccessedAt = meta.updatedAt;
      meta.stats = {
        messageCount: llm.length,
        tokenCount: this.estimateTokens(llm),
        lastTurnAt: Date.now(),
      };
      e.updatedAt = now;
      map[key] = e as Record<string, unknown>;
    });
    invalidateSessionSearchIndexCache();
  }

  /** Incremental sessions.json stats after guard append (OpenClaw transcript-events). */
  async syncSessionsJsonFromTranscriptUpdate(update: SessionTranscriptUpdate): Promise<void> {
    const sessionKey = update.sessionKey?.trim();
    if (!sessionKey || !existsSync(update.sessionFile)) {
      return;
    }
    return this.runStoreMutation(async () => {
      const rows = await readTranscriptRowsFromFile(update.sessionFile);
      const llm = rowsToLlmMessages(rows);
      const keyStorePath = this.resolveStorePathForKey(sessionKey);
      await withSessionsJsonLock(keyStorePath, async (map) => {
        const e = map[sessionKey] as XopcSessionDiskEntry | undefined;
        if (!e?.pluginExtensions?.xopc?.metadata) {
          return;
        }
        const meta = e.pluginExtensions.xopc.metadata;
        meta.messageCount = llm.length;
        meta.estimatedTokens = this.estimateTokens(llm);
        meta.updatedAt = new Date().toISOString();
        meta.lastAccessedAt = meta.updatedAt;
        meta.stats = {
          messageCount: llm.length,
          tokenCount: this.estimateTokens(llm),
          lastTurnAt: Date.now(),
        };
        e.updatedAt = Date.now();
        map[sessionKey] = e as Record<string, unknown>;
      });
      invalidateSessionSearchIndexCache();
    });
  }

  async appendTranscriptContextEntry(
    key: string,
    entry: Omit<XopcTranscriptContextEntry, 'kind'> & Partial<Pick<XopcTranscriptContextEntry, 'kind'>>,
  ): Promise<void> {
    return this.runStoreMutation(async () => {
      await this.ensureSession(key);
      const disk = await this.getDiskEntry(key);
      if (!disk) {
        return;
      }
      const keySessionsDir = this.resolveSessionsDirForKey(key);
      const absPath = this.transcriptPathForEntry(disk, keySessionsDir);
      const row: XopcTranscriptContextEntry = {
        kind: 'context',
        id: typeof entry.id === 'string' ? entry.id : undefined,
        text: typeof entry.text === 'string' ? entry.text : undefined,
        data: entry.data,
        createdAt: entry.createdAt ?? new Date().toISOString(),
      };
      await appendPiTranscriptContextEntry({
        absPath,
        cwd: process.cwd(),
        entry: row,
        sessionKey: key,
      });
      const rows = existsSync(absPath) ? await readTranscriptRowsFromFile(absPath) : [];
      const llm = rowsToLlmMessages(rows);
      const keyStorePath = this.resolveStorePathForKey(key);
      await withSessionsJsonLock(keyStorePath, async (map) => {
        const e = map[key] as XopcSessionDiskEntry | undefined;
        if (!e?.pluginExtensions?.xopc?.metadata) {
          return;
        }
        const meta = e.pluginExtensions.xopc.metadata;
        meta.messageCount = llm.length;
        meta.estimatedTokens = this.estimateTokens(llm);
        meta.updatedAt = new Date().toISOString();
        meta.lastAccessedAt = meta.updatedAt;
        meta.stats = {
          messageCount: llm.length,
          tokenCount: this.estimateTokens(llm),
          lastTurnAt: Date.now(),
        };
        e.updatedAt = Date.now();
        map[key] = e as Record<string, unknown>;
      });
      invalidateSessionSearchIndexCache();
    });
  }

  /**
   * @deprecated Runtime agent turns must persist via {@link guardSessionManager} + appendMessage.
   * Retained for compaction, tests, and admin tools until fully removed.
   */
  async saveMessages(key: string, messages: AgentMessage[]): Promise<void> {
    return this.runStoreMutation(async () => {
      await this.ensureSession(key);
      const prev = await this.loadTranscriptRows(key);
      const merged = mergeLlmMessagesPreservingContextRows(prev, messages);
      await this.writeTranscriptAndSyncIndex(key, merged);
    });
  }

  getWindowStats(messages: AgentMessage[]) {
    return this.window.getStats(messages);
  }

  needsCompaction(key: string, messages: AgentMessage[], contextWindow: number) {
    return this.compactor.needsCompaction(messages, contextWindow);
  }

  prepareCompaction(
    key: string,
    messages: AgentMessage[],
    contextWindow: number,
  ): { needsCompaction: boolean; messages: AgentMessage[]; stats?: ReturnType<typeof this.compactor.needsCompaction> } {
    const result = this.compactor.needsCompaction(messages, contextWindow);
    return { needsCompaction: result.needed, messages, stats: result };
  }

  private checkpointBasename(sessionId: string): string {
    return `${sessionId}.checkpoint.`;
  }

  private async pruneCompactionCheckpoints(sessionId: string, sessionsDir: string): Promise<void> {
    const MAX = 15;
    const prefix = this.checkpointBasename(sessionId);
    let names: string[];
    try {
      names = await readdir(sessionsDir);
    } catch {
      return;
    }
    const candidates = names.filter((n) => n.startsWith(prefix) && n.endsWith('.jsonl'));
    if (candidates.length <= MAX) {
      return;
    }
    const stats = await Promise.all(
      candidates.map(async (name) => {
        const p = join(sessionsDir, name);
        try {
          const s = await stat(p);
          return { p, mtimeMs: s.mtimeMs };
        } catch {
          return { p: join(sessionsDir, name), mtimeMs: 0 };
        }
      }),
    );
    stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (let i = 0; i < stats.length - MAX; i++) {
      try {
        await unlink(stats[i]!.p);
      } catch {
        /* ignore */
      }
    }
  }

  private async captureCompactionCheckpoint(sessionId: string, transcriptAbs: string, sessionsDir: string): Promise<void> {
    if (!existsSync(transcriptAbs)) {
      return;
    }
    const id = randomUUID();
    const dest = join(sessionsDir, `${sessionId}.checkpoint.${id}.jsonl`);
    try {
      await copyFile(transcriptAbs, dest);
      await this.pruneCompactionCheckpoints(sessionId, sessionsDir);
    } catch (err) {
      log.warn({ err, sessionId }, 'Compaction checkpoint copy failed');
    }
  }

  async applyCompaction(
    key: string,
    messages: AgentMessage[],
    result: CompactionResult,
  ): Promise<AgentMessage[]> {
    const compacted = this.compactor.applyCompaction(messages, result);
    return this.runStoreMutation(async () => {
      const entry = await this.getDiskEntry(key);
      if (!entry) {
        return compacted;
      }
      const keySessionsDir = this.resolveSessionsDirForKey(key);
      const abs = this.transcriptPathForEntry(entry, keySessionsDir);
      await this.captureCompactionCheckpoint(entry.sessionId, abs, keySessionsDir);
      const prev = await this.loadTranscriptRows(key);
      const merged = mergeLlmMessagesPreservingContextRows(prev, compacted);
      await this.writeTranscriptAndSyncIndex(key, merged, {
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
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return [];
    }
    const keySessionsDir = this.resolveSessionsDirForKey(key);
    const sessionId = entry.sessionId;
    const prefix = this.checkpointBasename(sessionId);
    let names: string[];
    try {
      names = await readdir(keySessionsDir);
    } catch {
      return [];
    }
    const files = names.filter((n) => n.startsWith(prefix) && n.endsWith('.jsonl'));
    const rows = await Promise.all(
      files.map(async (name) => {
        const p = join(keySessionsDir, name);
        const parsed = parseCompactionCheckpointTranscriptFileName(name);
        const id = parsed?.checkpointId;
        if (!id || !normalizeCompactionCheckpointId(id)) {
          return null;
        }
        try {
          const s = await stat(p);
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

  async getCompactionCheckpointDetail(
    key: string,
    checkpointId: string,
  ): Promise<CompactionCheckpointDetail | null> {
    const id = normalizeCompactionCheckpointId(checkpointId);
    if (!id) {
      return null;
    }
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return null;
    }
    const keySessionsDir = this.resolveSessionsDirForKey(key);
    const fname = `${this.checkpointBasename(entry.sessionId)}${id}.jsonl`;
    const cpPath = join(keySessionsDir, fname);
    if (!existsSync(cpPath)) {
      return null;
    }
    try {
      const rows = await readTranscriptRowsFromFile(cpPath);
      const llm = rowsToLlmMessages(rows);
      const s = await stat(cpPath);
      return {
        id,
        sizeBytes: s.size,
        modifiedAt: new Date(s.mtimeMs).toISOString(),
        messageCount: llm.length,
      };
    } catch {
      return null;
    }
  }

  async restoreCompactionCheckpoint(key: string, checkpointId: string): Promise<void> {
    const id = normalizeCompactionCheckpointId(checkpointId);
    if (!id) {
      throw new Error('Invalid checkpoint id');
    }
    return this.runStoreMutation(async () => {
      const entry = await this.getDiskEntry(key);
      if (!entry) {
        throw new Error(`Session not found: ${key}`);
      }
      const keySessionsDir = this.resolveSessionsDirForKey(key);
      const cpPath = join(keySessionsDir, `${this.checkpointBasename(entry.sessionId)}${id}.jsonl`);
      if (!existsSync(cpPath)) {
        throw new Error(`Checkpoint not found: ${id}`);
      }
      const target = this.transcriptPathForEntry(entry, keySessionsDir);
      await copyFile(cpPath, target);
      const messages = await this.loadMessages(key);
      await this.saveMessages(key, messages);
      log.info({ key, checkpointId: id }, 'Session transcript restored from compaction checkpoint');
    });
  }

  async deleteSession(key: string): Promise<boolean> {
    return this.delete(key);
  }

  async load(key: string, options?: { fromArchive?: boolean }): Promise<AgentMessage[]> {
    return this.loadMessages(key, options);
  }

  /** @deprecated See {@link saveMessages}. */
  async save(key: string, messages: AgentMessage[]): Promise<void> {
    return this.saveMessages(key, messages);
  }

  async estimateTokenUsage(_key: string, messages: AgentMessage[]): Promise<number> {
    return this.estimateTokens(messages);
  }

  async searchInSession(key: string, keyword: string): Promise<Message[]> {
    const messages = await this.loadDisplayMessages(key);
    const keywordLower = keyword.toLowerCase();
    return this.convertMessages(
      messages.filter((m) => {
        const content = this.extractTextContent(this.messageContent(m));
        return content.toLowerCase().includes(keywordLower);
      }),
    );
  }

  async exportSession(key: string, format: ExportFormat): Promise<string> {
    const detail = await this.get(key);
    if (!detail) {
      throw new Error(`Session not found: ${key}`);
    }
    if (format === 'json') {
      const transcriptRows = await this.loadTranscriptRows(key);
      const exportData: SessionExport = {
        version: INDEX_VERSION,
        exportedAt: new Date().toISOString(),
        metadata: detail,
        messages: detail.messages,
        transcriptRows,
      };
      return JSON.stringify(exportData, null, 2);
    }
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
      lines.push(`## ${role}`, '');
      const body = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
      lines.push(body, '', '---', '');
    }
    return lines.join('\n');
  }

  async getStats(): Promise<GlobalSessionStats> {
    const list = await this.list({ limit: 100000 });
    const sessions = list.items;
    const byChannel: Record<string, number> = {};
    for (const s of sessions) {
      byChannel[s.sourceChannel] = (byChannel[s.sourceChannel] || 0) + 1;
    }
    let oldestSession: string | undefined;
    let newestSession: string | undefined;
    if (sessions.length > 0) {
      const sorted = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      oldestSession = sorted[0]!.createdAt;
      newestSession = sorted[sorted.length - 1]!.createdAt;
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

  async archiveOld(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const list = await this.list({ limit: 100000 });
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
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil(this.extractTextContent(this.messageContent(msg)).length / 4);
    }
    return total;
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
    const entry = await this.getDiskEntry(key);
    if (!entry) {
      return;
    }
    const keySessionsDir = this.resolveSessionsDirForKey(key);
    const abs = this.transcriptPathForEntry(entry, keySessionsDir);
    const workspaceDir = resolveEffectiveAgentProfileForSession(this.options.config, key).resolvedWorkspacePath;
    try {
      await appendPiTranscriptContextEntry({
        absPath: abs,
        cwd: workspaceDir,
        sessionKey: key,
        entry: {
          kind: 'context',
          id: `post-compaction-${Date.now()}`,
          text: contextText,
          createdAt: new Date().toISOString(),
        },
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
        if (inputTokens != null || outputTokens != null || totalTokens != null) {
          row.usage = { inputTokens, outputTokens, totalTokens };
        }
      }
      return row;
    });
  }
}
