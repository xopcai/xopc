import { withModelConfigLock } from '../../session/model-config-lock.js';
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

import { randomUUID } from 'node:crypto';

import type { AgentService } from '../../agent/service.js';
import type { CompactionResult } from '../../agent/memory/compaction.js';
import { retireSessionMcpRuntimeForConversationId } from '../../agent/mcp/bundle-mcp-tools.js';
import { SessionIndex } from '../../session/index.js';
import type { ExportFormat, SessionListQuery } from '../../session/types.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { buildSessionTimeline } from '../../session/transcript-outline.js';
import type { SessionPatchBody } from '../../session/patch-metadata.js';
import { collectMediaUrisFromValues, deleteMediaUris } from '../../media/session-references.js';
import { getDistinctSessionChatIds } from './session-chat-ids.js';
import { performSessionReset, type SessionResetResult } from '../session-reset-service.js';
import { resolveAgentIdFromConversationId } from '../../routing/agent-session-key.js';
import type { ActiveExecution } from './active-execution.js';

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
  getActiveWebchatRunId: (conversationId: string) => string | undefined;
  /** Snapshot of all in-flight webchat runs for workspace briefing surfaces. */
  listActiveWebchatRuns: () => Array<{ conversationId: string; runId: string }>;
  /** Rich in-flight execution snapshot used for shutdown impact policy. */
  listActiveExecutions: () => ActiveExecution[];
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

  /** List conversations whose stored type is workflow-subagent. */
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
    conversationId?: string;
    transcriptId?: string;
  }): Promise<
    | {
        conversationId: string;
        transcriptId: string;
        session: Awaited<ReturnType<GatewaySessionsApi['getSession']>>;
      }
    | null
  > {
    const explicitKey = input.conversationId?.trim();
    const resolvedKey =
      explicitKey ||
      (input.transcriptId?.trim()
        ? await this.opts.sessionIndex.resolveConversationIdByTranscriptId(input.transcriptId.trim())
        : null);
    if (!resolvedKey) {
      return null;
    }
    const session = await this.getSession(resolvedKey);
    if (!session?.transcriptId) {
      return null;
    }
    return { conversationId: resolvedKey, transcriptId: session.transcriptId, session };
  }

  /** Read-only: in-flight webchat agent run for this session key, if any. */
  getActiveRun(conversationId: string): { active: boolean; runId?: string } {
    const key = conversationId.trim();
    if (!key) return { active: false };
    const runId = this.opts.getActiveWebchatRunId(key)?.trim();
    if (!runId) return { active: false };
    return { active: true, runId };
  }

  listActiveRuns(): Array<{ conversationId: string; runId: string }> {
    return this.opts.listActiveWebchatRuns();
  }

  async getQuitImpact(): Promise<{
    shouldConfirm: boolean;
    blockingCount: number;
    blockingRuns: Array<ActiveExecution & { title?: string }>;
    backgroundCount: number;
    assessedAt: number;
  }> {
    const executions = this.opts.listActiveExecutions();
    const enriched = await Promise.all(executions.map(async (execution) => {
      const session = await this.getSession(execution.conversationId);
      const title = session?.name?.trim().slice(0, 120);
      const triggerSource = typeof session?.customData?.triggerSource === 'string'
        ? session.customData.triggerSource
        : undefined;
      const backgroundSession = session?.sessionType === 'cron'
        || session?.sessionType === 'heartbeat'
        || triggerSource === 'automation';
      return { execution, title, backgroundSession };
    }));
    const blockingRuns = enriched
      .filter(({ execution, backgroundSession }) => (
        execution.initiator === 'user' && execution.phase === 'running' && !backgroundSession
      ))
      .map(({ execution, title }) => ({ ...execution, ...(title ? { title } : {}) }));
    return {
      shouldConfirm: blockingRuns.length > 0,
      blockingCount: blockingRuns.length,
      blockingRuns,
      backgroundCount: executions.length - blockingRuns.length,
      assessedAt: Date.now(),
    };
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

  async getAgentConfig(conversationId: string) {
    return this.opts.getAgentService().sessionInspector.agentConfig(conversationId);
  }

  async getFixedAgentConfig(conversationId: string) {
    return withModelConfigLock(conversationId, async () => {
      const config = await this.getAgentConfig(conversationId);
      if (!config.fixedModel && !this.getActiveRun(conversationId).active) {
        const result = await this.opts.getAgentService().sessionConfig.initializeModelSelection(conversationId, config.model, config.thinkingLevel, config.configVersion);
        if (result.ok) return this.getAgentConfig(conversationId);
      }
      return config;
    });
  }

  initializeChatModel(conversationId: string, model: string, thinkingLevel?: string) {
    return this.opts.getAgentService().sessionConfig.initializeModelSelection(conversationId, model, thinkingLevel);
  }

  /** Resolved markdown workspace for a session (after hydration / mkdir). */
  getEffectiveWorkspacePath(conversationId: string): Promise<string> {
    return this.opts.getAgentService().getEffectiveWorkspacePathForSession(conversationId);
  }

  patchAgentConfig(
    conversationId: string,
    body: {
      thinkingLevel?: string;
      fixedModel?: boolean;
      configVersion?: number;
      model?: string | null;
      activityDetailLevel?: string | null;
      reasoningLevel?: string | null;
      verboseLevel?: string;
      workingDirectory?: string;
      responseLanguage?: string | null;
      userContextMode?: 'enabled' | 'off' | 'temporary';
    },
  ) {
    return this.opts.getAgentService().sessionConfig.patch(conversationId, body);
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
    const transcriptRows = await this.opts.sessionIndex.getStore()
      .loadTranscriptHistoryRows(key)
      .catch(() => []);
    const result = await this.opts.sessionIndex.deleteSession(key);
    if (result) {
      await deleteMediaUris(collectMediaUrisFromValues(transcriptRows));
      this.opts.getAgentService().evictSessionAgent(key);
      await retireSessionMcpRuntimeForConversationId({ conversationId: key, reason: 'session-delete' });
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

  findMessages(key: string, query: string, limit?: number) {
    return this.opts.sessionIndex.getStore().findInSession(key, query, limit);
  }

  async export(key: string, format: ExportFormat): Promise<{ content: string }> {
    const content = await this.opts.sessionIndex.exportSession(key, format);
    return { content };
  }

  importExport(
    targetKey: string,
    jsonContent: string,
  ): Promise<{ conversationId: string; rowCount: number }> {
    return this.opts.sessionIndex.importSessionExport(targetKey, jsonContent);
  }

  fork(
    key: string,
    targetKey: string,
  ): Promise<{ conversationId: string; rowCount: number }> {
    return this.opts.sessionIndex.forkSession(key, targetKey);
  }

  forkRows(
    key: string,
    targetKey: string,
    options: { throughRow?: number } = {},
  ): Promise<{ conversationId: string; rowCount: number }> {
    return this.opts.sessionIndex.forkSessionRows(key, targetKey, options);
  }

  async forkAtTurn(
    sourceKey: string,
    lastTurnId: string,
  ): Promise<{
    conversationId: string;
    rowCount: number;
    lastTurnId: string;
    session: NonNullable<Awaited<ReturnType<GatewaySessionsApi['getSession']>>>;
  }> {
    const source = await this.opts.sessionIndex.getSessionMetadata(sourceKey);
    if (!source) throw new Error(`Session not found: ${sourceKey}`);
    if (source.sessionType !== 'chat') {
      throw new Error('Only chat sessions can be forked');
    }
    const normalizedTurnId = lastTurnId.trim();
    if (!normalizedTurnId) throw new Error('lastTurnId is required');
    if (this.opts.getActiveWebchatRunId(sourceKey)?.trim() === normalizedTurnId) {
      throw new Error('Cannot fork a turn that is still running');
    }

    const agentId = source.routing?.agentId?.trim() || resolveAgentIdFromConversationId(sourceKey);
    const chatId = `chat_${randomUUID()}`;
    const targetKey = randomUUID();
    const result = await this.opts.sessionIndex.forkSessionAtTurn(sourceKey, {
      targetKey,
      lastTurnId: normalizedTurnId,
      targetMetadata: {
        sourceChannel: 'webchat',
        sourceChatId: `default:direct:${chatId}`,
        sessionType: 'chat',
        routing: {
          agentId,
          source: 'webchat',
          accountId: 'default',
          peerKind: 'direct',
          peerId: chatId,
        },
      },
    });
    const session = await this.getSession(result.conversationId);
    if (!session) throw new Error(`Forked session not found: ${result.conversationId}`);
    return { ...result, lastTurnId: normalizedTurnId, session };
  }

  btwQuery(conversationId: string, question: string): Promise<{ text: string; error?: string }> {
    return this.opts.getAgentService().sessionInspector.btwQuery(conversationId, question);
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
