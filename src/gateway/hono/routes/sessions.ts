import { patchChatModelConfig } from './chat-model-config.js';
import { randomUUID } from 'node:crypto';

import type { Hono } from 'hono';

import { getSessionContextSummary } from '../../session-context-summary.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';

import { buildSessionKey } from '../../../routing/session-key.js';
import { resolveProjectAgentId } from '../../../projects/index.js';
import type { SessionMetadataSeed } from '../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { createGatewayRouteLogger, logRouteError } from '../lib/route-logger.js';
import { messagesToClientHistory } from '../../../session/client-history.js';
import type { SessionType } from '../../../session/types.js';
import { deleteMediaUrisNoLongerReferenced } from '../../../media/session-references.js';
import { respondStartupUnavailable } from '../lib/startup-unavailable.js';
import type { StartupUnavailableGatewayMethod } from '../../startup-readiness.js';
import { evictEmbeddedSessionRunner } from '../../../agent/embedded/session-runner.js';
import { SessionEnvironmentService } from '../../../execution-environments/session-environment-service.js';
import type { ProjectExecutionMode } from '../../../projects/types.js';

const log = createGatewayRouteLogger('Sessions');

type SessionsStartupMethod = StartupUnavailableGatewayMethod;

const SESSION_TYPES = new Set<SessionType>(['chat', 'workflow-run', 'workflow-subagent', 'cron', 'heartbeat']);
const DEFAULT_SIDEBAR_STALE_DAYS = 60;

function isSessionType(value: string): value is SessionType {
  return SESSION_TYPES.has(value as SessionType);
}

function parseExecutionMode(value: unknown): ProjectExecutionMode | undefined {
  return value === 'local_checkout' || value === 'managed_worktree' ? value : undefined;
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

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function parseOffset(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 0;
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function isHistoryCursor(value: string): boolean {
  if (!/^(0|[1-9]\d*)$/.test(value)) return false;
  return Number.isSafeInteger(Number(value));
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
    hiddenFromSessionList: true,
    routing: {
      agentId: params.agentId,
      source: params.source,
      accountId: params.accountId,
      peerKind: 'direct',
      peerId: params.peerId,
    },
    customData: {
      genericNewChatShell: params.source === 'webchat' && params.peerId.startsWith('chat_'),
    },
  };
}

export function registerSessionsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const environments = new SessionEnvironmentService();

  // ========== Session REST API (/api/sessions) ==========

  authenticated.get('/api/sessions/:key/context-summary', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.list');
    if (blocked) return blocked;
    c.header('Cache-Control', 'no-store');
    const summary = await getSessionContextSummary(service.currentConfig, c.req.param('key'), getGatewayPrincipal(c).scopes);
    return summary ? c.json({ summary }) : c.json({ error: 'Session not found' }, 404);
  });

  authenticated.get('/api/session-runs', (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.list');
    if (blocked) return blocked;
    return c.json({ ok: true, payload: { runs: service.sessions.listActiveRuns() } });
  });

  authenticated.get('/api/sidebar/chat-list', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.list');
    if (blocked) {
      return blocked;
    }

    const projectLimit = parsePositiveInt(c.req.query('projectLimit'), 12, 50);
    const projectOffset = parseOffset(c.req.query('projectOffset'));
    const sessionPreviewLimit = parsePositiveInt(c.req.query('sessionPreviewLimit'), 5, 20);
    const inboxLimit = parsePositiveInt(c.req.query('inboxLimit'), 20, 100);
    const inboxOffset = parseOffset(c.req.query('inboxOffset'));
    const staleDays = parsePositiveInt(c.req.query('staleDays'), DEFAULT_SIDEBAR_STALE_DAYS, 3650);
    const updatedAfter = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    const includeSessionKey = c.req.query('includeSessionKey')?.trim() || undefined;

    const projects = service.projects.listWithSidebarSessions({
      status: 'active',
      limit: projectLimit,
      offset: projectOffset,
      updatedAfter,
      includePinned: true,
      includeSessionKey,
    });
    const projectItems = await Promise.all(
      projects.items.map(async (project) => {
        const sessions = await service.sessions.listSessions({
          projectId: project.id,
          limit: sessionPreviewLimit,
          offset: 0,
          updatedAfter,
          includePinned: true,
          includeSessionKey,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        });
        return {
          project,
          sessions: sessions.items,
          sessionTotal: sessions.total,
          sessionHasMore: sessions.hasMore,
        };
      }),
    );
    const inbox = await service.sessions.listSessions({
      unassigned: true,
      limit: inboxLimit,
      offset: inboxOffset,
      updatedAfter,
      includePinned: true,
      includeSessionKey,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    return c.json({
      ok: true,
      projects: {
        items: projectItems,
        total: projects.total,
        limit: projects.limit,
        offset: projects.offset,
        hasMore: projects.hasMore,
      },
      inbox,
    });
  });

  // POST /api/sessions - Create a new session. Empty-shell reuse is a client concern.
  authenticated.post('/api/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel = typeof body.channel === 'string' && body.channel.trim() ? body.channel.trim() : 'webchat';
    const projectId = typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : undefined;
    const routingCfg = service.currentConfig;
    const project = projectId ? service.projects.get(projectId) : null;
    if (projectId && !project) {
      return c.json({ ok: false, error: 'Project not found' }, 404);
    }
    const requestedExecutionMode = parseExecutionMode(body.executionMode);
    if (body.executionMode !== undefined && !requestedExecutionMode) {
      return c.json({ ok: false, error: 'Invalid execution mode' }, 400);
    }
    const agentId = resolveProjectAgentId({
      config: routingCfg,
      projects: service.projects,
      explicitAgentId: typeof body.agentId === 'string' ? body.agentId : undefined,
      projectId,
    });
    const requestedChatId = typeof body.chat_id === 'string' && body.chat_id.trim()
      ? body.chat_id.trim()
      : undefined;
    const chatId = requestedChatId ?? `chat_${randomUUID()}`;
    const sessionKey = buildSessionKey({
      agentId,
      source: channel,
      accountId: 'default',
      peerKind: 'direct',
      peerId: chatId,
    });

    let environment;
    if (project && (project.workspaceRoot?.trim() || requestedExecutionMode)) {
      try {
        environment = await environments.attach({
          sessionKey,
          project,
          mode: requestedExecutionMode,
          baseRef: typeof body.baseRef === 'string' ? body.baseRef : undefined,
        });
      } catch (error) {
        return c.json({
          ok: false,
          code: 'execution_environment_unavailable',
          error: error instanceof Error ? error.message : String(error),
        }, 409);
      }
    }

    try {
      await service.sessionIndexInstance.saveMessages(sessionKey, [], {
        metadata: buildDirectSessionMetadata({
          agentId,
          source: channel,
          accountId: 'default',
          peerId: chatId,
        }),
      });

      if (projectId) {
        service.projects.attachSession(sessionKey, projectId);
      }
    } catch (error) {
      await service.sessions.delete(sessionKey).catch(() => undefined);
      await environments.release(sessionKey).catch(() => undefined);
      throw error;
    }
    const rawInitialConfig = body.initialAgentConfig && typeof body.initialAgentConfig === 'object'
      ? body.initialAgentConfig as Record<string, unknown>
      : {};
    const model = typeof rawInitialConfig.model === 'string' && rawInitialConfig.model.trim()
      ? rawInitialConfig.model.trim()
      : undefined;
    const thinkingLevel = typeof rawInitialConfig.thinkingLevel === 'string' && rawInitialConfig.thinkingLevel.trim()
      ? rawInitialConfig.thinkingLevel.trim()
      : undefined;
    const initialAgentConfig = {
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(body.temporary === true ? { userContextMode: 'temporary' as const } : {}),
    };
    if (channel === 'webchat' && model) {
      const result = await service.sessions.initializeChatModel(sessionKey, model, thinkingLevel);
      if (!result.ok) {
        await service.sessions.delete(sessionKey).catch(() => undefined);
        await environments.release(sessionKey).catch((error) => {
          log.warn({ err: error, sessionKey }, 'Invalid new session model and execution environment cleanup failed');
        });
        return c.json({ ok: false, error: result.error }, 400);
      }
      delete initialAgentConfig.model;
      delete initialAgentConfig.thinkingLevel;
    }
    if (Object.keys(initialAgentConfig).length > 0) {
      const result = await service.sessions.patchAgentConfig(sessionKey, initialAgentConfig);
      if (!result.ok) {
        await service.sessions.delete(sessionKey).catch(() => undefined);
        await environments.release(sessionKey).catch((error) => {
          log.warn({ err: error, sessionKey }, 'Invalid new session config and execution environment cleanup failed');
        });
        return c.json({ ok: false, error: result.error }, 400);
      }
    }
    const session = await service.sessions.getSession(sessionKey);
    const agentConfig = channel === 'webchat' ? await service.sessions.getFixedAgentConfig(sessionKey) : undefined;
    return c.json({ session, agentConfig, ...(environment ? { environment } : {}) }, 201);
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
      projectId: query.projectId,
      unassigned: query.unassigned === 'true',
      updatedAfter: query.updatedAfter ? parseInt(query.updatedAfter) : undefined,
      includePinned: query.includePinned === 'true',
      includeSessionKey: query.includeSessionKey,
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
    const payload = await service.sessions.getFixedAgentConfig(key);
    return c.json({ ok: true, payload });
  });

  authenticated.patch('/api/sessions/:key/agent-config', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    return patchChatModelConfig(c, service, key, body);
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

    const beforeRaw = c.req.query('before');
    const before = beforeRaw?.trim();
    if (beforeRaw !== undefined && (!before || !isHistoryCursor(before))) {
      return c.json({ ok: false, error: 'Invalid session history cursor' }, 400);
    }
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
    const beforeRaw = c.req.query('before');
    const before = beforeRaw?.trim();
    if (beforeRaw !== undefined && (!before || !isHistoryCursor(before))) {
      return c.json({ error: 'Invalid session history cursor' }, 400);
    }
    const parsedOffset = offsetRaw ? Number.parseInt(offsetRaw, 10) : 0;
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    const limit = Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, parsedLimit)) : 50;
    const result = await service.sessions.getMessagePage(key, {
      offset,
      limit,
      ...(before ? { before } : {}),
      includeContextRows: true,
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

  // GET /api/sessions/:key/transcript/window — TUI-focused transcript slice around a row.
  authenticated.get('/api/sessions/:key/transcript/window', async (c) => {
    const blocked = ensureGatewayReadyForSessions(c, service, 'sessions.history');
    if (blocked) {
      return blocked;
    }
    const key = c.req.param('key');
    const rowNumberRaw = c.req.query('rowNumber');
    const rowNumber = rowNumberRaw ? Number.parseInt(rowNumberRaw, 10) : NaN;
    if (!Number.isFinite(rowNumber) || rowNumber < 1) {
      return c.json({ ok: false, error: 'rowNumber must be a positive integer' }, 400);
    }
    const before = parsePositiveInt(c.req.query('before'), 80, 200);
    const after = parsePositiveInt(c.req.query('after'), 120, 200);
    const window = await service.sessions.getTranscriptWindow(key, { rowNumber, before, after });
    if (!window) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    return c.json({ ok: true, payload: window });
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

  authenticated.get('/api/sessions/:key/compaction/boundaries', async (c) => {
    const key = c.req.param('key');
    const meta = await service.sessionIndexInstance.getSessionMetadata(key);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const boundaries = await service.sessions.listCompactionBoundaries(key);
    return c.json({ ok: true, payload: { boundaries } });
  });

  authenticated.post('/api/sessions/:key/compaction/restore', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const compactionId = typeof body.compactionId === 'string' ? body.compactionId.trim() : '';
    if (!compactionId) {
      return c.json({ ok: false, error: 'compactionId required' }, 400);
    }
    try {
      await service.sessions.restoreBeforeCompactionBoundary(key, compactionId);
    } catch (err) {
      logRouteError(log, c, err, 'gateway.route.sessions', { operation: 'restoreCompactionBoundary', sessionKey: key });
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) {
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
    let requestedProjectId: string | null | undefined;
    if ('projectId' in body) {
      requestedProjectId = typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : null;
      if (requestedProjectId && !service.projects.get(requestedProjectId)) {
        return c.json({ ok: false, error: 'Project not found' }, 404);
      }
      const currentProjectId = (await service.sessions.getSession(key))?.projectId ?? null;
      if (requestedProjectId !== currentProjectId && environments.get(key)) {
        return c.json({
          ok: false,
          code: 'execution_environment_active',
          error: 'Release the session execution environment before changing its project',
        }, 409);
      }
    }
    const result = await service.sessions.patch(key, patch);
    if (result.ok === false) {
      return c.json({ ok: false, error: result.error }, 404);
    }
    if (requestedProjectId !== undefined) {
      try {
        if (requestedProjectId) {
          service.projects.attachSession(key, requestedProjectId);
        } else {
          service.projects.detachSession(key);
        }
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 404);
      }
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

  // POST /api/sessions/:key/fork-at-turn — server-generated chat session fork.
  authenticated.post('/api/sessions/:key/fork-at-turn', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const lastTurnId = typeof body.lastTurnId === 'string' ? body.lastTurnId.trim() : '';
    if (!lastTurnId) {
      return c.json({ ok: false, error: 'lastTurnId is required' }, 400);
    }
    try {
      const result = await service.sessions.forkAtTurn(key, lastTurnId);
      return c.json({ ok: true, ...result }, 201);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const status = errorMessage.startsWith('Session not found:') ? 404 : 409;
      return c.json({ ok: false, error: errorMessage }, status);
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

  // DELETE /api/sessions/:key/messages — atomically delete one visible user turn from raw rows.
  authenticated.delete('/api/sessions/:key/messages', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const userRoundIndex =
      typeof body.userRoundIndex === 'number' ? body.userRoundIndex : undefined;
    if (userRoundIndex === undefined || !Number.isInteger(userRoundIndex) || userRoundIndex < 0) {
      return c.json({ error: 'userRoundIndex must be a non-negative integer' }, 400);
    }

    const result = await service.sessionIndexInstance.deleteUserRound(key, userRoundIndex);
    if (!result) {
      return c.json({ error: 'User round index out of range' }, 400);
    }
    await deleteMediaUrisNoLongerReferenced({
      removed: result.removedMessages,
      remaining: result.remainingMessages,
    });
    evictEmbeddedSessionRunner(key, 'gateway_user_round_deleted');
    service.agentService.evictSessionAgent(key);
    return c.json({ ok: true, deleted: result.deleted });
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
    if (environments.get(key) && service.getActiveWebchatRunId(key)) {
      return c.json({ ok: false, error: 'Stop the active session run before deleting its environment' }, 409);
    }
    const result = await service.sessions.delete(key);
    if (result.deleted) {
      await environments.release(key).catch((error) => {
        log.warn({ err: error, sessionKey: key }, 'Session deleted but execution environment cleanup failed');
      });
    }
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
