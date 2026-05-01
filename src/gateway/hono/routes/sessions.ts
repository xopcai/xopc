import type { Hono } from 'hono';

import { buildSessionKey, parseSessionKey } from '../../../routing/session-key.js';
import { agentExists, getDefaultAgentId } from '../../../routing/resolve-route.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { messagesToClientHistory } from '../../../session/client-history.js';

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

  // GET /api/sessions/:key - Get single session (must be after /stats and /chat-ids)
  authenticated.get('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ session });
  });

  // GET /api/sessions/:key/export - Export session (must be before /:key)
  authenticated.get('/api/sessions/:key/export', async (c) => {
    const key = c.req.param('key');
    const format = c.req.query('format') as any || 'json';
    const result = await service.exportSession(key, format);
    return c.json(result);
  });

  // DELETE /api/sessions/:key/messages — delete a range of messages by index (before whole-session DELETE)
  authenticated.delete('/api/sessions/:key/messages', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const startIndex = typeof body.startIndex === 'number' ? body.startIndex : -1;
    const count = typeof body.count === 'number' ? body.count : 0;
    if (startIndex < 0 || count <= 0) {
      return c.json({ error: 'Invalid startIndex or count' }, 400);
    }
    const loaded = await service.sessionManagerInstance.loadMessages(key);
    if (!loaded || startIndex >= loaded.length) {
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
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ error: 'Subagent session not found' }, 404);
    }
    return c.json({ session });
  });
}
