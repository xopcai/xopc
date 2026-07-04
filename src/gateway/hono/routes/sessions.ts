import type { Hono } from 'hono';

import { buildSessionKey } from '../../../routing/session-key.js';
import { agentExists, getDefaultAgentId } from '../../../routing/resolve-route.js';
import type { SessionMetadataSeed } from '../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { createGatewayRouteLogger, logRouteError } from '../lib/route-logger.js';
import { messagesToClientHistory } from '../../../session/client-history.js';
import type { SessionType } from '../../../session/types.js';
import { computeUserRoundDeleteRange } from '../../../session/user-round-delete.js';
import { deleteMediaUrisNoLongerReferenced } from '../../../media/session-references.js';
import { respondStartupUnavailable } from '../lib/startup-unavailable.js';
import type { StartupUnavailableGatewayMethod } from '../../startup-readiness.js';
import { evictEmbeddedSessionRunner } from '../../../agent/embedded/session-runner.js';

const log = createGatewayRouteLogger('Sessions');

type SessionsStartupMethod = StartupUnavailableGatewayMethod;

const SESSION_TYPES = new Set<SessionType>(['chat', 'workflow-run', 'workflow-subagent', 'cron', 'heartbeat']);

function isSessionType(value: string): value is SessionType {
  return SESSION_TYPES.has(value as SessionType);
}

function ensureGatewayReadyForSessions(
  c: Parameters<typeof respondStartupUnavailable>[0],
  service: AuthenticatedRouteDeps['service'],
  method: SessionsStartupMethod,
): Response | null {
  if (service.isGatewayReady()) {
    return null;
  }
  return respondStartupUnavailable(c, method);
}

function buildDirectSessionMetadata(params: {
  agentId: string;
  source: string;
  accountId: string;
  peerId: string;
}): SessionMetadataSeed {
  return {
    sourceChannel: params.source,
    sourceChatId: [params.accountId, 'direct', params.peerId].join(':'),
    sessionType: 'chat',
    routing: {
      agentId: params.agentId,
      source: params.source,
      accountId: params.accountId,
      peerKind: 'direct',
      peerId: params.peerId,
    },
  };
}

export function registerSessionsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  // ========== Session REST API (/api/sessions) ==========

  // POST /api/sessions - Create new session (reuses empty sessions)
  authenticated.post('/api/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel = body.channel || 'webchat';
    const routingCfg = service.currentConfig;
    let agentId =
      typeof body.agentId === 'string' && body.agentId.trim()
        ? body.agentId.trim().toLowerCase()
        : getDefaultAgentId(routingCfg);
    if (!agentExists(agentId, routingCfg)) {
      agentId = getDefaultAgentId(routingCfg);
    }

    // If a specific chat_id is provided, use it (for advanced use cases)
    // Otherwise, try to find and reuse an existing empty session
    if (body.chat_id) {
      const sessionKey = buildSessionKey({
        agentId,
        source: channel,
        accountId: 'default',
        peerKind: 'direct',
        peerId: body.chat_id,
      });

      await service.sessionIndexInstance.saveMessages(sessionKey, [], {
        metadata: buildDirectSessionMetadata({
          agentId,
          source: channel,
          accountId: 'default',
          peerId: body.chat_id,
        }),
      });
      const session = await service.sessions.getSession(sessionKey);
      return c.json({ session }, 201);
    }

    // Look for existing empty sessions to reuse
    const existingSessions = await service.sessions.listSessions({
      channel,
      limit: 50,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    
    // Reuse an empty session only when it matches the requested agent (session key embeds agent id).
    const emptySession = existingSessions.items.find((s) => {
      if (s.messageCount !== 0) return false;
      return s.routing?.agentId === agentId;
    });
    
    if (emptySession) {
      // Return existing empty session instead of creating a new one
      const session = await service.sessions.getSession(emptySession.key);
      return c.json({ session, reused: true }, 200);
    }
    
    // No empty session found, create a new one
    const chatId = `chat_${Date.now()}`;
    const sessionKey = buildSessionKey({
      agentId,
      source: channel,
      accountId: 'default',
      peerKind: 'direct',
      peerId: chatId,
    });

    await service.sessionIndexInstance.saveMessages(sessionKey, [], {
      metadata: buildDirectSessionMetadata({
        agentId,
        source: channel,
        accountId: 'default',
        peerId: chatId,
      }),
    });

    const session = await service.sessions.getSession(sessionKey);
    return c.json({ session }, 201);
  });

  // GET /api/sessions - List sessions
  authenticated.get('/api/sessions', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.list');
    if (blocked) {
      return blocked;
    }
    const query = c.req.query();
    const sessionTypes = query.types
      ?.split(',')
      .map((value) => value.trim())
      .filter(isSessionType);
    const result = await service.sessions.listSessions({
      status: query.status as any,
      search: query.search,
      channel: query.channel,
      sessionTypes: sessionTypes?.length ? sessionTypes : undefined,
      includeHidden: query.includeHidden === 'true',
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return c.json(result);
  });

  // GET /api/sessions/stats - Get session stats (must be before /:key)
  authenticated.get('/api/sessions/stats', async (c) => {
    const result = await service.sessions.stats();
    return c.json(result);
  });

  // GET /api/sessions/chat-ids - Get unique chat IDs from sessions (must be before /:key)
  authenticated.get('/api/sessions/chat-ids', async (c) => {
    const channel = c.req.query('channel');
    const chatIds = await service.sessions.chatIds(channel || undefined);
    return c.json({ ok: true, payload: { chatIds } });
  });

  // GET /api/sessions/resolve?sessionId=... - Resolve OpenClaw-style session id to canonical key.
  authenticated.get('/api/sessions/resolve', async (c) => {
    const result = await service.sessions.resolveSession({
      sessionId: c.req.query('sessionId'),
      sessionKey: c.req.query('sessionKey') ?? c.req.query('key'),
    });
    if (!result) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    return c.json({ ok: true, payload: result });
  });

  // POST /api/sessions/resolve - Resolve by JSON body (`sessionId`, `sessionKey`, or `key`).
  authenticated.post('/api/sessions/resolve', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await service.sessions.resolveSession({
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : undefined,
      key: typeof body.key === 'string' ? body.key : undefined,
    });
    if (!result) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    return c.json({ ok: true, payload: result });
  });

  // GET /api/sessions/:key/run — read-only active webchat agent run (for UI resume)
  authenticated.get('/api/sessions/:key/run', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.run');
    if (blocked) {
      return blocked;
    }
    const key = c.req.param('key');
    const session = await service.sessions.getSession(key);
    if (!session) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    return c.json({ ok: true, payload: service.sessions.getActiveRun(key) });
  });

  // GET /api/sessions/:key/agent-config — resolved session agent settings (thinking, etc.)
  authenticated.get('/api/sessions/:key/agent-config', async (c) => {
    const key = c.req.param('key');
    const payload = await service.sessions.getAgentConfig(key);
    return c.json({ ok: true, payload });
  });

  authenticated.patch('/api/sessions/:key/agent-config', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const result = await service.sessions.patchAgentConfig(key, body);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, 400);
    }
    return c.json({ ok: true });
  });

  // GET /api/sessions/:key/messages — flattened transcript for TUI / clients
  authenticated.get('/api/sessions/:key/messages', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.messages');
    if (blocked) {
      return blocked;
    }
    const key = c.req.param('key');
    const limitRaw = c.req.query('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const limit =
      parsedLimit !== undefined && Number.isFinite(parsedLimit)
        ? Math.min(500, Math.max(1, parsedLimit))
        : undefined;

    const before = c.req.query('before')?.trim();
    const offsetRaw = c.req.query('offset');
    const parsedOffset = offsetRaw ? Number.parseInt(offsetRaw, 10) : 0;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;

    const result = await service.sessions.getMessagePage(key, {
      limit,
      offset,
      ...(before ? { before } : {}),
    });
    if (!result) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }

    const messages = messagesToClientHistory(result.session.messages, { limit });
    return c.json({
      ok: true,
      payload: { messages },
      pagination: result.pagination,
    });
  });

  // GET /api/sessions/:key/history — UI chat history page from the newest tail.
  authenticated.get('/api/sessions/:key/history', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.history');
    if (blocked) {
      return blocked;
    }
    const key = c.req.param('key');
    const offsetRaw = c.req.query('offset');
    const limitRaw = c.req.query('limit');
    const before = c.req.query('before')?.trim();
    const parsedOffset = offsetRaw ? Number.parseInt(offsetRaw, 10) : 0;
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    const limit = Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, parsedLimit)) : 50;
    const result = await service.sessions.getMessagePage(key, {
      offset,
      limit,
      ...(before ? { before } : {}),
    });

    if (!result) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json(result);
  });

  // GET /api/sessions/:key/timeline — row-backed conversation outline for Web / TUI navigation.
  authenticated.get('/api/sessions/:key/timeline', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.history');
    if (blocked) {
      return blocked;
    }
    const key = c.req.param('key');
    const items = await service.sessions.getTimeline(key);
    if (!items) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    return c.json({ ok: true, items });
  });

  // POST /api/sessions/:key/transcript/context — append persisted-only `kind: 'context'` row (not in LLM context)
  authenticated.post('/api/sessions/:key/transcript/context', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionIndexInstance.getSessionMetadata(key);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
    const text = typeof body.text === 'string' ? body.text : undefined;
    const data =
      body.data !== undefined && typeof body.data === 'object' && body.data !== null && !Array.isArray(body.data)
        ? (body.data as Record<string, unknown>)
        : undefined;
    await service.sessionIndexInstance.appendTranscriptContextEntry(key, { id, text, data });
    return c.json({ ok: true });
  });

  // POST /api/sessions/:key/transcript/label — append label change for a transcript entry.
  authenticated.post('/api/sessions/:key/transcript/label', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionIndexInstance.getSessionMetadata(key);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
    if (!targetId) {
      return c.json({ ok: false, error: 'targetId is required' }, 400);
    }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined;
    await service.sessionIndexInstance.appendTranscriptLabelEntry(key, { targetId, label });
    return c.json({ ok: true });
  });

  // POST /api/sessions/:key/transcript/custom — append extension state for TUI replay.
  authenticated.post('/api/sessions/:key/transcript/custom', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionIndexInstance.getSessionMetadata(key);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const customType = typeof body.customType === 'string' ? body.customType.trim() : '';
    if (!customType) {
      return c.json({ ok: false, error: 'customType is required' }, 400);
    }
    await service.sessionIndexInstance.appendTranscriptCustomEntry(key, {
      customType,
      data: body.data,
    });
    return c.json({ ok: true });
  });

  // POST /api/sessions/:key/transcript/custom-message — append visible extension custom message.
  authenticated.post('/api/sessions/:key/transcript/custom-message', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionIndexInstance.getSessionMetadata(key);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const customType = typeof body.customType === 'string' ? body.customType.trim() : '';
    if (!customType) {
      return c.json({ ok: false, error: 'customType is required' }, 400);
    }
    const content =
      typeof body.content === 'string' || Array.isArray(body.content) ? body.content : '';
    await service.sessionIndexInstance.appendTranscriptCustomMessageEntry(key, {
      customType,
      content,
      display: typeof body.display === 'boolean' ? body.display : undefined,
      details: body.details,
    });
    evictEmbeddedSessionRunner(key, 'gateway_custom_message_appended');
    return c.json({ ok: true });
  });

  // POST /api/sessions/:key/transcript/bash — append local TUI shell execution.
  authenticated.post('/api/sessions/:key/transcript/bash', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionIndexInstance.getSessionMetadata(key);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const command = typeof body.command === 'string' ? body.command.trim() : '';
    if (!command) {
      return c.json({ ok: false, error: 'command is required' }, 400);
    }
    await service.sessionIndexInstance.appendTranscriptBashExecutionEntry(key, {
      command,
      output: typeof body.output === 'string' ? body.output : '',
      exitCode: typeof body.exitCode === 'number' ? body.exitCode : body.exitCode === null ? null : undefined,
      signal: typeof body.signal === 'string' ? body.signal : body.signal === null ? null : undefined,
      excludeFromContext: body.excludeFromContext === true,
      truncated: body.truncated === true,
      fullOutputPath: typeof body.fullOutputPath === 'string' ? body.fullOutputPath : undefined,
    });
    evictEmbeddedSessionRunner(key, 'gateway_bash_execution_appended');
    return c.json({ ok: true });
  });

  // GET /api/sessions/:key/compaction/checkpoints — list pre-compaction snapshots (OpenClaw-style)
  authenticated.get('/api/sessions/:key/compaction/checkpoints', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionIndexInstance.getSessionMetadata(key);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const checkpoints = await service.sessions.listCompactionCheckpoints(key);
    return c.json({ ok: true, payload: { checkpoints } });
  });

  authenticated.get('/api/sessions/:key/compaction/checkpoints/:checkpointId', async (c) => {
    const key = c.req.param('key');
    const checkpointId = c.req.param('checkpointId');
    const checkpoint = await service.sessions.getCompactionCheckpoint(key, checkpointId);
    if (!checkpoint) {
      return c.json({ ok: false, error: 'Checkpoint not found' }, 404);
    }
    return c.json({ ok: true, payload: { checkpoint } });
  });

  authenticated.post('/api/sessions/:key/compaction/restore', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const checkpointId = typeof body.checkpointId === 'string' ? body.checkpointId.trim() : '';
    if (!checkpointId) {
      return c.json({ ok: false, error: 'checkpointId required' }, 400);
    }
    try {
      await service.sessions.restoreCompactionCheckpoint(key, checkpointId);
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.sessions', { operation: 'restoreCheckpoint', sessionKey: key });
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found') || msg.includes('Invalid')) {
        return c.json({ ok: false, error: msg }, 404);
      }
      return c.json({ ok: false, error: msg }, 500);
    }
    const session = await service.sessions.getSession(key);
    if (!session) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    return c.json({ ok: true, session });
  });

  authenticated.post('/api/sessions/:key/compaction/run', async (c) => {
    const key = c.req.param('key');
    const session = await service.sessions.getSession(key);
    if (!session) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const instructions = typeof body.instructions === 'string' ? body.instructions : undefined;
    const force = typeof body.force === 'boolean' ? body.force : true;
    const result = await service.sessions.runCompaction(key, { instructions, force });
    return c.json({ ok: true, payload: { result } });
  });

  // GET /api/sessions/:key - Get single session (must be after /stats and /chat-ids)
  authenticated.get('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const includeRaw = c.req.query('include') ?? '';
    const includeSet = new Set(
      includeRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const includeTranscript = includeSet.has('transcript');
    const includeTranscriptRows = includeSet.has('transcriptRows');
    const offsetRaw = c.req.query('offset');
    const limitRaw = c.req.query('limit');
    const hasPagingQuery = offsetRaw !== undefined || limitRaw !== undefined;

    if (hasPagingQuery) {
      const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.history');
      if (blocked) {
        return blocked;
      }
      const parsedOffset = offsetRaw ? Number.parseInt(offsetRaw, 10) : 0;
      const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
      const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
      const limit = Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, parsedLimit)) : 50;
      const result = await service.sessions.getMessagePage(key, {
        offset,
        limit,
        includeTranscriptSummary: includeTranscript,
        includeTranscriptRows,
      });
      if (!result) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json(result);
    }

    const session = await service.sessions.getSession(key, {
      includeTranscriptSummary: includeTranscript,
      includeTranscriptRows,
    });
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ session });
  });

  // PATCH /api/sessions/:key - Partial metadata (name, tags, customData); OpenClaw-style patch subset
  authenticated.patch('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const patch: {
      name?: string;
      tags?: string[];
      replaceTags?: boolean;
      customData?: Record<string, unknown>;
    } = {};
    if (typeof body.name === 'string') {
      patch.name = body.name;
    }
    if (Array.isArray(body.tags)) {
      patch.tags = body.tags;
    }
    if (typeof body.replaceTags === 'boolean') {
      patch.replaceTags = body.replaceTags;
    }
    if (body.customData !== undefined && typeof body.customData === 'object' && body.customData !== null) {
      patch.customData = body.customData as Record<string, unknown>;
    }
    const result = await service.sessions.patch(key, patch);
    if (result.ok === false) {
      return c.json({ ok: false, error: result.error }, 404);
    }

    const session = await service.sessions.getSession(key);
    return c.json({ ok: true, session });
  });

  // GET /api/sessions/:key/export - Export session (must be before /:key)
  authenticated.get('/api/sessions/:key/export', async (c) => {
    const key = c.req.param('key');
    const format = c.req.query('format') as any || 'json';
    const result = await service.sessions.export(key, format);
    return c.json(result);
  });

  authenticated.post('/api/sessions/import', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const targetKey = typeof body.targetKey === 'string' ? body.targetKey : '';
    const content = typeof body.content === 'string' ? body.content : '';
    if (!targetKey.trim()) {
      return c.json({ ok: false, error: 'targetKey is required' }, 400);
    }
    if (!content.trim()) {
      return c.json({ ok: false, error: 'content is required' }, 400);
    }
    try {
      const result = await service.sessions.importExport(targetKey, content);
      return c.json({ ok: true, ...result });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: errorMessage }, 400);
    }
  });

  authenticated.post('/api/sessions/:key/btw', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const question = typeof body.question === 'string' ? body.question : '';
    const result = await service.sessions.btwQuery(key, question);
    return c.json(result);
  });

  authenticated.post('/api/sessions/:key/fork', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const targetKey = typeof body.targetKey === 'string' ? body.targetKey : '';
    if (!targetKey.trim()) {
      return c.json({ ok: false, error: 'targetKey is required' }, 400);
    }
    try {
      const result = await service.sessions.fork(key, targetKey);
      return c.json({ ok: true, ...result });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: errorMessage }, 400);
    }
  });

  authenticated.post('/api/sessions/:key/fork-row', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const targetKey = typeof body.targetKey === 'string' ? body.targetKey : '';
    const throughRow = typeof body.throughRow === 'number' ? Math.trunc(body.throughRow) : NaN;
    if (!targetKey.trim()) {
      return c.json({ ok: false, error: 'targetKey is required' }, 400);
    }
    if (!Number.isFinite(throughRow) || throughRow < 1) {
      return c.json({ ok: false, error: 'throughRow must be a positive integer' }, 400);
    }
    try {
      const result = await service.sessions.forkRows(key, targetKey, { throughRow });
      return c.json({ ok: true, ...result });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: errorMessage }, 400);
    }
  });

  // DELETE /api/sessions/:key/messages — delete LLM rows by range or by user turn.
  // `userRoundIndex` (0-based among user messages) removes the user row and every following
  // assistant / tool / toolResult row until the next user. Prefer this from the web console so
  // tool loops are not left orphaned after retry/delete.
  authenticated.delete('/api/sessions/:key/messages', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const loaded = await service.sessionIndexInstance.loadMessages(key);
    if (!loaded) {
      return c.json({ error: 'Session not found' }, 404);
    }

    let startIndex = typeof body.startIndex === 'number' ? body.startIndex : -1;
    let count = typeof body.count === 'number' ? body.count : 0;
    const userRoundIndex =
      typeof body.userRoundIndex === 'number' ? body.userRoundIndex : undefined;

    if (userRoundIndex !== undefined) {
      const range = computeUserRoundDeleteRange(loaded, userRoundIndex);
      if (!range) {
        return c.json({ error: 'User round index out of range' }, 400);
      }
      startIndex = range.startIndex;
      count = range.count;
    }

    if (startIndex < 0 || count <= 0) {
      return c.json({ error: 'Invalid startIndex or count' }, 400);
    }
    if (startIndex >= loaded.length) {
      return c.json({ error: 'Index out of range' }, 400);
    }
    const deleteCount = Math.min(count, loaded.length - startIndex);
    const removed = loaded.slice(startIndex, startIndex + deleteCount);
    const next = loaded.slice(0, startIndex).concat(loaded.slice(startIndex + deleteCount));
    await service.sessionIndexInstance.saveMessages(key, next);
    await deleteMediaUrisNoLongerReferenced({ removed, remaining: next });
    return c.json({ ok: true, deleted: deleteCount });
  });

  // POST /api/sessions/:key/reset - Reset session (archive transcript, new session id; keep key + overrides)
  authenticated.post('/api/sessions/:key/reset', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.reset');
    if (blocked) {
      return blocked;
    }
    const key = c.req.param('key');
    const result = await service.sessions.reset(key);
    if (result.ok === false) {
      const status = result.error === 'Session not found' ? 404 : 400;
      return c.json({ ok: false, error: result.error }, status);
    }
    const session = await service.sessions.getSession(key);
    return c.json({
      ok: true,
      reset: true,
      sessionId: result.sessionId,
      previousSessionId: result.previousSessionId,
      session,
    });
  });

  // DELETE /api/sessions/:key - Delete session (removes key from index)
  authenticated.delete('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const result = await service.sessions.delete(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/archive - Archive session
  authenticated.post('/api/sessions/:key/archive', async (c) => {
    const key = c.req.param('key');
    const result = await service.sessions.archive(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/unarchive - Unarchive session
  authenticated.post('/api/sessions/:key/unarchive', async (c) => {
    const key = c.req.param('key');
    const result = await service.sessions.unarchive(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/pin - Pin session
  authenticated.post('/api/sessions/:key/pin', async (c) => {
    const key = c.req.param('key');
    const result = await service.sessions.pin(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/unpin - Unpin session
  authenticated.post('/api/sessions/:key/unpin', async (c) => {
    const key = c.req.param('key');
    const result = await service.sessions.unpin(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/rename - Rename session
  authenticated.post('/api/sessions/:key/rename', async (c) => {
    const key = c.req.param('key');

    const body = await c.req.json();
    const { name } = body;
    const result = await service.sessions.rename(key, name);
    return c.json(result);
  });

  // ========== Subagent REST API (/api/subagents) ==========

  // GET /api/subagents - List subagent sessions
  authenticated.get('/api/subagents', async (c) => {
    const query = c.req.query();
    const result = await service.sessions.listSubagents({
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return c.json(result);
  });

  // GET /api/subagents/:key - Get subagent session detail
  authenticated.get('/api/subagents/:key', async (c) => {
    const key = c.req.param('key');
    // Verify it's a subagent session
    if (!key.startsWith('subagent:')) {
      return c.json({ error: 'Not a subagent session' }, 400);
    }
    const includeRaw = c.req.query('include') ?? '';
    const includeSet = new Set(
      includeRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const session = await service.sessions.getSession(key, {
      includeTranscriptSummary: includeSet.has('transcript'),
      includeTranscriptRows: includeSet.has('transcriptRows'),
    });
    if (!session) {
      return c.json({ error: 'Subagent session not found' }, 404);
    }
    return c.json({ session });
  });
}
