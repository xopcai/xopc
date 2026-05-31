import type { Hono } from 'hono';

import { buildSessionKey, parseSessionKey } from '../../../routing/session-key.js';
import { agentExists, getDefaultAgentId } from '../../../routing/resolve-route.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { messagesToClientHistory } from '../../../session/client-history.js';
import { computeUserRoundDeleteRange } from '../../../session/user-round-delete.js';
import { respondStartupUnavailable } from '../lib/startup-unavailable.js';

function ensureGatewayReadyForSessions(
  c: Parameters<typeof respondStartupUnavailable>[0],
  service: AuthenticatedRouteDeps['service'],
  method: 'sessions.history' | 'sessions.messages' | 'sessions.list',
): Response | null {
  if (service.isGatewayReady()) {
    return null;
  }
  return respondStartupUnavailable(c, method);
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

      await service.sessionManagerInstance.saveMessages(sessionKey, []);
      const session = await service.getSession(sessionKey);
      return c.json({ session }, 201);
    }
    
    // Look for existing empty sessions to reuse
    const existingSessions = await service.listSessions({
      channel,
      limit: 50,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    
    // Reuse an empty session only when it matches the requested agent (session key embeds agent id).
    const emptySession = existingSessions.items.find((s) => {
      if (s.messageCount !== 0) return false;
      const parsed = parseSessionKey(s.key);
      return parsed?.agentId === agentId;
    });
    
    if (emptySession) {
      // Return existing empty session instead of creating a new one
      const session = await service.getSession(emptySession.key);
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

    await service.sessionManagerInstance.saveMessages(sessionKey, []);

    const session = await service.getSession(sessionKey);
    return c.json({ session }, 201);
  });

  // GET /api/sessions - List sessions
  authenticated.get('/api/sessions', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.list');
    if (blocked) {
      return blocked;
    }
    const query = c.req.query();
    const result = await service.listSessions({
      status: query.status as any,
      search: query.search,
      channel: query.channel,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return c.json(result);
  });

  // GET /api/sessions/stats - Get session stats (must be before /:key)
  authenticated.get('/api/sessions/stats', async (c) => {
    const result = await service.getSessionStats();
    return c.json(result);
  });

  // GET /api/sessions/chat-ids - Get unique chat IDs from sessions (must be before /:key)
  authenticated.get('/api/sessions/chat-ids', async (c) => {
    const channel = c.req.query('channel');
    const chatIds = await service.getSessionChatIds(channel || undefined);
    return c.json({ ok: true, payload: { chatIds } });
  });

  // GET /api/sessions/:key/agent-config — resolved session agent settings (thinking, etc.)
  authenticated.get('/api/sessions/:key/agent-config', async (c) => {
    const key = c.req.param('key');
    const payload = await service.getSessionAgentConfig(key);
    return c.json({ ok: true, payload });
  });

  authenticated.patch('/api/sessions/:key/agent-config', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const result = await service.patchSessionAgentConfig(key, body);
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

    const session = await service.getSession(key);
    if (!session) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }

    const messages = messagesToClientHistory(session.messages, { limit });
    return c.json({ ok: true, payload: { messages } });
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
    const result = await service.getSessionMessagePage(key, {
      offset,
      limit,
      ...(before ? { before } : {}),
    });

    if (!result) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json(result);
  });

  // POST /api/sessions/:key/transcript/context — append persisted-only `kind: 'context'` row (not in LLM context)
  authenticated.post('/api/sessions/:key/transcript/context', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionManagerInstance.getSessionMetadata(key);
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
    await service.sessionManagerInstance.appendTranscriptContextEntry(key, { id, text, data });
    return c.json({ ok: true });
  });

  // GET /api/sessions/:key/compaction/checkpoints — list pre-compaction snapshots (OpenClaw-style)
  authenticated.get('/api/sessions/:key/compaction/checkpoints', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionManagerInstance.getSessionMetadata(key);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const checkpoints = await service.listSessionCompactionCheckpoints(key);
    return c.json({ ok: true, payload: { checkpoints } });
  });

  authenticated.get('/api/sessions/:key/compaction/checkpoints/:checkpointId', async (c) => {
    const key = c.req.param('key');
    const checkpointId = c.req.param('checkpointId');
    const checkpoint = await service.getSessionCompactionCheckpoint(key, checkpointId);
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
      await service.restoreSessionCompactionCheckpoint(key, checkpointId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found') || msg.includes('Invalid')) {
        return c.json({ ok: false, error: msg }, 404);
      }
      return c.json({ ok: false, error: msg }, 500);
    }
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    return c.json({ ok: true, session });
  });

  authenticated.post('/api/sessions/:key/compaction/run', async (c) => {
    const key = c.req.param('key');
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const instructions = typeof body.instructions === 'string' ? body.instructions : undefined;
    const force = typeof body.force === 'boolean' ? body.force : true;
    const result = await service.runSessionCompaction(key, { instructions, force });
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
      const result = await service.getSessionMessagePage(key, {
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

    const session = await service.getSession(key, {
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
    const result = await service.patchSession(key, patch);
    if (result.ok === false) {
      return c.json({ ok: false, error: result.error }, 404);
    }
    const session = await service.getSession(key);
    return c.json({ ok: true, session });
  });

  // GET /api/sessions/:key/export - Export session (must be before /:key)
  authenticated.get('/api/sessions/:key/export', async (c) => {
    const key = c.req.param('key');
    const format = c.req.query('format') as any || 'json';
    const result = await service.exportSession(key, format);
    return c.json(result);
  });

  // DELETE /api/sessions/:key/messages — delete LLM rows by range or by user turn.
  // `userRoundIndex` (0-based among user messages) removes the user row and every following
  // assistant / tool / toolResult row until the next user. Prefer this from the web console so
  // tool loops are not left orphaned after retry/delete.
  authenticated.delete('/api/sessions/:key/messages', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const loaded = await service.sessionManagerInstance.loadMessages(key);
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
    const next = loaded.slice(0, startIndex).concat(loaded.slice(startIndex + deleteCount));
    await service.sessionManagerInstance.saveMessages(key, next);
    return c.json({ ok: true, deleted: deleteCount });
  });

  // DELETE /api/sessions/:key - Delete session
  authenticated.delete('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const result = await service.deleteSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/archive - Archive session
  authenticated.post('/api/sessions/:key/archive', async (c) => {
    const key = c.req.param('key');
    const result = await service.archiveSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/unarchive - Unarchive session
  authenticated.post('/api/sessions/:key/unarchive', async (c) => {
    const key = c.req.param('key');
    const result = await service.unarchiveSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/pin - Pin session
  authenticated.post('/api/sessions/:key/pin', async (c) => {
    const key = c.req.param('key');
    const result = await service.pinSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/unpin - Unpin session
  authenticated.post('/api/sessions/:key/unpin', async (c) => {
    const key = c.req.param('key');
    const result = await service.unpinSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/rename - Rename session
  authenticated.post('/api/sessions/:key/rename', async (c) => {
    const key = c.req.param('key');

    const body = await c.req.json();
    const { name } = body;
    const result = await service.renameSession(key, name);
    return c.json(result);
  });

  // ========== Subagent REST API (/api/subagents) ==========

  // GET /api/subagents - List subagent sessions
  authenticated.get('/api/subagents', async (c) => {
    const query = c.req.query();
    const result = await service.listSubagents({
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
    const session = await service.getSession(key, {
      includeTranscriptSummary: includeSet.has('transcript'),
      includeTranscriptRows: includeSet.has('transcriptRows'),
    });
    if (!session) {
      return c.json({ error: 'Subagent session not found' }, 404);
    }
    return c.json({ session });
  });
}
