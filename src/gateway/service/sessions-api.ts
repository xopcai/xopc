/**
 * GatewaySessionsApi — session CRUD, search, compaction, tag/pin/archive,
 * stats, and chat-id grouping for the gateway REST surface.
 *
 * Twenty-four methods, previously sitting on `GatewayService` as a mix of
 * one-line `sessionIndex.*` delegations and small composite operations (e.g.
 * `restoreCheckpoint` also evicts the in-memory agent, `runCompaction` also
 * appends a transcript context entry). Centralising them here lets routes
 * depend on the narrow `GatewaySessionsApi` surface instead of the full
 * `GatewayService`, and keeps the gateway composition root focused on
 * lifecycle + wiring.
 */

import type { AgentService } from '../../agent/service.js';
import type { CompactionResult } from '../../agent/memory/compaction.js';
import { retireSessionMcpRuntimeForSessionKey } from '../../agent/mcp/bundle-mcp-tools.js';
import { SessionIndex } from '../../session/index.js';
import type { ExportFormat, SessionListQuery } from '../../session/types.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { buildSessionTimeline } from '../../session/transcript-outline.js';
import type { SessionPatchBody } from '../../session/patch-metadata.js';
import { collectMediaUrisFromMessages, deleteMediaUris } from '../../media/session-references.js';
import { getDistinctSessionChatIds } from './session-chat-ids.js';
import { performSessionReset, type SessionResetResult } from '../session-reset-service.js';

function clampWindowSpan(value: number | undefined, fallback: number): number {
  const parsed = Math.trunc(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(200, Math.max(0, parsed));
}

export interface GatewaySessionsApiOptions {
  sessionIndex: SessionIndex;
  /** Resolves the live agent service (created lazily; throws if gateway is starting). */
  getAgentService: () => AgentService;
  /** Read-only view of in-flight webchat runs (per session key → run id). */
  getActiveWebchatRunId: (sessionKey: string) => string | undefined;
}

export class GatewaySessionsApi {
  private readonly opts: GatewaySessionsApiOptions;

  constructor(opts: GatewaySessionsApiOptions) {
    this.opts = opts;
  }

  // ── List / get ─────────────────────────────────────────────────────────

  listSessions(query?: SessionListQuery) {
    return this.opts.sessionIndex.listSessions(query);
  }

  /** Subagent sessions have keys starting with `subagent:`. */
  listSubagents(query?: SessionListQuery) {
    return this.opts.sessionIndex.listSubagents(query);
  }

  getSession(
    key: string,
    options?: { includeTranscriptSummary?: boolean; includeTranscriptRows?: boolean },
  ) {
    return this.opts.sessionIndex.getSession(key, options);
  }

  async resolveSession(input: {
    key?: string;
    sessionKey?: string;
    sessionId?: string;
  }): Promise<
    | {
        sessionKey: string;
        sessionId: string;
        session: Awaited<ReturnType<GatewaySessionsApi['getSession']>>;
      }
    | null
  > {
    const explicitKey = input.sessionKey?.trim() || input.key?.trim();
    const resolvedKey =
      explicitKey ||
      (input.sessionId?.trim()
        ? await this.opts.sessionIndex.resolveSessionKeyBySessionId(input.sessionId.trim())
        : null);
    if (!resolvedKey) {
      return null;
    }
    const session = await this.getSession(resolvedKey);
    if (!session?.sessionId) {
      return null;
    }
    return { sessionKey: resolvedKey, sessionId: session.sessionId, session };
  }

  /** Read-only: in-flight webchat agent run for this session key, if any. */
  getActiveRun(sessionKey: string): { active: boolean; runId?: string } {
    const key = sessionKey.trim();
    if (!key) return { active: false };
    const runId = this.opts.getActiveWebchatRunId(key)?.trim();
    if (!runId) return { active: false };
    return { active: true, runId };
  }

  getMessagePage(
    key: string,
    options?: {
      offset?: number;
      limit?: number;
      before?: string;
      includeTranscriptSummary?: boolean;
      includeTranscriptRows?: boolean;
      includeContextRows?: boolean;
    },
  ) {
    return this.opts.sessionIndex.getSessionMessagePage(key, options);
  }

  async getTimeline(key: string) {
    const metadata = await this.opts.sessionIndex.getSessionMetadata(key);
    if (!metadata) return null;
    const rows = await this.opts.sessionIndex.getStore().loadTranscriptHistoryRows(key);
    return buildSessionTimeline(rows);
  }

  async getTranscriptWindow(
    key: string,
    options: { rowNumber: number; before?: number; after?: number },
  ) {
    const metadata = await this.opts.sessionIndex.getSessionMetadata(key);
    if (!metadata) return null;
    const rows = await this.opts.sessionIndex.getStore().loadTranscriptHistoryRows(key);
    const totalRows = rows.length;
    if (totalRows === 0) {
      return {
        messages: [],
        startRowNumber: 0,
        endRowNumber: 0,
        totalRows,
      };
    }

    const targetRowNumber = Math.min(totalRows, Math.max(1, Math.trunc(options.rowNumber)));
    const before = clampWindowSpan(options.before, 80);
    const after = clampWindowSpan(options.after, 120);
    const startRowNumber = Math.max(1, targetRowNumber - before);
    const endRowNumber = Math.min(totalRows, targetRowNumber + after);

    return {
      messages: transcriptRowsToClientHistory(rows, { startRowNumber, endRowNumber }),
      startRowNumber,
      endRowNumber,
      totalRows,
    };
  }

  // ── Metadata patches ──────────────────────────────────────────────────

  patch(key: string, body: SessionPatchBody): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.opts.sessionIndex.patchSession(key, body);
  }

  async getAgentConfig(sessionKey: string) {
    return this.opts.getAgentService().sessionInspector.agentConfig(sessionKey);
  }

  /** Resolved markdown workspace for a session (after hydration / mkdir). */
  getEffectiveWorkspacePath(sessionKey: string): Promise<string> {
    return this.opts.getAgentService().getEffectiveWorkspacePathForSession(sessionKey);
  }

  patchAgentConfig(
    sessionKey: string,
    body: {
      thinkingLevel?: string;
      model?: string | null;
      activityDetailLevel?: string | null;
      reasoningLevel?: string | null;
      verboseLevel?: string;
      workingDirectory?: string;
      responseLanguage?: string | null;
      userContextMode?: 'enabled' | 'off' | 'temporary';
    },
  ) {
    return this.opts.getAgentService().sessionConfig.patch(sessionKey, body);
  }

  // ── Append-only compaction boundaries ────────────────────────────────

  listCompactionBoundaries(key: string) {
    return this.opts.sessionIndex.listCompactionBoundaries(key);
  }

  async restoreBeforeCompactionBoundary(key: string, compactionId: string): Promise<void> {
    await this.opts.sessionIndex.restoreBeforeCompactionBoundary(key, compactionId);
    this.opts.getAgentService().evictSessionAgent(key);
  }

  async runCompaction(
    key: string,
    options?: { instructions?: string; force?: boolean },
  ): Promise<CompactionResult> {
    const result = await this.opts.getAgentService().sessionInspector.compact(key, options);
    if (result.compacted) {
      void this.opts.sessionIndex
        .appendTranscriptContextEntry(key, {
          text: 'Session transcript compacted',
          data: {
            firstKeptIndex: result.firstKeptIndex,
            tokensBefore: result.tokensBefore,
            tokensAfter: result.tokensAfter,
            summaryPreview: result.summary.slice(0, 500),
          },
        })
        .catch(() => {});
    }
    return result;
  }

  // ── Lifecycle (delete / rename / tag / pin / archive) ─────────────────

  async delete(key: string): Promise<{ deleted: boolean }> {
    const messages = await this.opts.sessionIndex.loadMessages(key).catch(() => []);
    const result = await this.opts.sessionIndex.deleteSession(key);
    if (result) {
      await deleteMediaUris(collectMediaUrisFromMessages(messages));
      this.opts.getAgentService().evictSessionAgent(key);
      await retireSessionMcpRuntimeForSessionKey({ sessionKey: key, reason: 'session-delete' });
    }
    return { deleted: result };
  }

  /** Reset transcript in place (archive + new session id); preserves session key and overrides. */
  reset(key: string): Promise<SessionResetResult> {
    return performSessionReset(key, {
      sessionIndex: this.opts.sessionIndex,
      getAgentService: this.opts.getAgentService,
    });
  }

  deleteMany(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    return this.opts.sessionIndex.deleteSessions(keys);
  }

  async rename(key: string, name: string): Promise<{ renamed: boolean }> {
    await this.opts.sessionIndex.renameSession(key, name);
    return { renamed: true };
  }

  async tag(key: string, tags: string[]): Promise<{ tagged: boolean }> {
    await this.opts.sessionIndex.tagSession(key, tags);
    return { tagged: true };
  }

  async untag(key: string, tags: string[]): Promise<{ untagged: boolean }> {
    await this.opts.sessionIndex.untagSession(key, tags);
    return { untagged: true };
  }

  async archive(key: string): Promise<{ archived: boolean }> {
    await this.opts.sessionIndex.archiveSession(key);
    return { archived: true };
  }

  async unarchive(key: string): Promise<{ unarchived: boolean }> {
    await this.opts.sessionIndex.unarchiveSession(key);
    return { unarchived: true };
  }

  async pin(key: string): Promise<{ pinned: boolean }> {
    await this.opts.sessionIndex.pinSession(key);
    return { pinned: true };
  }

  async unpin(key: string): Promise<{ unpinned: boolean }> {
    await this.opts.sessionIndex.unpinSession(key);
    return { unpinned: true };
  }

  // ── Search + export + stats ───────────────────────────────────────────

  search(query: string) {
    return this.opts.sessionIndex.searchSessions(query);
  }

  searchIn(key: string, keyword: string) {
    return this.opts.sessionIndex.searchInSession(key, keyword);
  }

  async export(key: string, format: ExportFormat): Promise<{ content: string }> {
    const content = await this.opts.sessionIndex.exportSession(key, format);
    return { content };
  }

  importExport(
    targetKey: string,
    jsonContent: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    return this.opts.sessionIndex.importSessionExport(targetKey, jsonContent);
  }

  fork(
    key: string,
    targetKey: string,
  ): Promise<{ sessionKey: string; rowCount: number }> {
    return this.opts.sessionIndex.forkSession(key, targetKey);
  }

  forkRows(
    key: string,
    targetKey: string,
    options: { throughRow?: number } = {},
  ): Promise<{ sessionKey: string; rowCount: number }> {
    return this.opts.sessionIndex.forkSessionRows(key, targetKey, options);
  }

  btwQuery(sessionKey: string, question: string): Promise<{ text: string; error?: string }> {
    return this.opts.getAgentService().sessionInspector.btwQuery(sessionKey, question);
  }

  stats() {
    return this.opts.sessionIndex.getStats();
  }

  /**
   * Distinct chat-id pairs from sessions, grouped by channel. Used by automation
   * configuration UI to seed the "send to existing chat" picker.
   */
  chatIds(channel?: string): Promise<
    Array<{
      channel: string;
      chatId: string;
      lastActive: string;
      accountId?: string;
      peerKind?: string;
      peerId?: string;
    }>
  > {
    return getDistinctSessionChatIds(this.opts.sessionIndex, channel);
  }
}
