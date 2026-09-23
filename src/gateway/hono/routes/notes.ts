import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import type { Context, Hono } from 'hono';
import { NoteGetOutputSchema, NoteDeleteOutputSchema, ProductReadContracts, type ProductReadId } from '@xopcai/gateway-contract';
import { CapabilityError } from '../../../capabilities/runtime/dispatcher.js';
import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { stream } from 'hono/streaming';

import { resolveConversationId } from '../../../routing/session-key.js';
import { agentExists, getDefaultAgentId } from '../../../routing/resolve-route.js';
import type { CaptureChannel, CaptureSource, Note, NoteKind, NoteStatus, SnapshotTrigger } from '../../../notes/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { resolveGatewayEffectiveHost } from '../../../config/gateway-bind.js';
import { resolveReverseProxyPublicUrl } from '../../public-url.js';
import { getShareStore } from '../../../share/share-store.js';
import { resolveShareUrl } from '../../../share/share-url.js';
import { NoteShareService, NoteShareVersionConflictError } from '../../../share/note-share-service.js';
import type { ShareConfig } from '../../../share/share-types.js';

const VALID_KINDS = new Set<NoteKind>(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed', 'task']);
const VALID_STATUSES = new Set<NoteStatus>(['inbox', 'processed', 'archived', 'trashed']);
const VALID_CHANNELS = new Set<CaptureChannel>(['app', 'web', 'electron', 'tui', 'telegram', 'wechat', 'feishu']);

function noteNotFound() {
  return { error: 'Note not found', code: 'note_not_found' };
}

function readIdempotencyKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  return key || undefined;
}

function parseCaptureSource(body: Record<string, unknown>): CaptureSource {
  const channel = typeof body.channel === 'string' && VALID_CHANNELS.has(body.channel as CaptureChannel)
    ? (body.channel as CaptureChannel)
    : 'web';
  const platform = body.platform === 'ios' || body.platform === 'android' || body.platform === 'harmonyos' ? body.platform : undefined;
  return { channel, platform };
}

function buildNotePatch(body: Record<string, unknown>): Partial<Note> {
  const patch: Partial<Note> = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.markdown === 'string') patch.markdown = body.markdown;
  if (typeof body.kind === 'string' && VALID_KINDS.has(body.kind as NoteKind)) patch.kind = body.kind as NoteKind;
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status as NoteStatus)) patch.status = body.status as NoteStatus;
  if (Array.isArray(body.tags)) patch.tags = body.tags.filter((tag): tag is string => typeof tag === 'string');
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
  if (typeof body.localVersion === 'number') patch.localVersion = body.localVersion;
  if (body.ai && typeof body.ai === 'object') patch.ai = body.ai as Note['ai'];
  if (body.aiDeep && typeof body.aiDeep === 'object') patch.aiDeep = body.aiDeep as Note['aiDeep'];
  return patch;
}

function noteThreadName(note: Note): string {
  const title = note.title?.trim() || note.markdown.trim().slice(0, 28) || '未命名笔记';
  return `讨论：${title}`;
}

export function registerNotesRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const capabilities = createProductDispatcher(() => service.notesServiceInstance, { getProjects: () => service.projects });
  const invokeRead = async (c: Context, operation: ProductReadId, input: unknown) =>
    ProductReadContracts[operation].output.parse(await capabilities.call(operation, input, capabilityHttpContext(c)));
  const invokeNote = async (c: Context, operation: string, input: unknown, key?: string) => {
    const context = capabilityHttpContext(c);
    return NoteGetOutputSchema.parse(await capabilities.call(operation, input, context,
      { ...capabilities.describe(operation, context), idempotencyKey: key ?? randomUUID() }));
  };
  const shareConfig = (): Partial<ShareConfig> => {
    const gateway = service.currentConfig?.gateway as Record<string, unknown> | undefined;
    const raw = gateway?.share;
    return raw && typeof raw === 'object' ? raw as Partial<ShareConfig> : {};
  };
  const shareStore = () => {
    const store = getShareStore(shareConfig());
    store.updateConfig(shareConfig());
    return store;
  };
  const noteShares = () => new NoteShareService(shareStore(), service.notesServiceInstance);
  const shareUrlContext = () => ({
    gatewayHost: resolveGatewayEffectiveHost(service.currentConfig),
    gatewayPort: service.currentConfig?.gateway?.port ?? 18790,
    reverseProxyPublicUrl: resolveReverseProxyPublicUrl(service.currentConfig),
  });


  // POST /api/notes/quick-capture — minimal text capture
  authenticated.post('/api/notes/quick-capture', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return c.json({ error: 'Missing required field: text' }, 400);
    }
    const source = parseCaptureSource(body);
    const idempotencyKey = readIdempotencyKey(c.req.header('idempotency-key'));
    if (idempotencyKey && idempotencyKey.length > 200) {
      return c.json({ error: 'Idempotency-Key is too long' }, 400);
    }
    try {
      return c.json(await invokeNote(c, 'xopc.notes.capture', { text, capturedVia: source }, idempotencyKey), 201);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  // GET /api/notes — list with filters
  authenticated.get('/api/notes', async (c) => {
    try {
      const input: Record<string, unknown> = { ...c.req.query() };
      for (const key of ['limit', 'offset']) if (input[key] !== undefined) input[key] = Number(input[key]);
      for (const key of ['pinned', 'unassigned', 'agentEdited']) {
        if (input[key] === 'true') input[key] = true;
        if (input[key] === 'false') input[key] = false;
      }
      return c.json(await capabilities.call('xopc.notes.list', input, capabilityHttpContext(c)));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/notes/project-summaries', async (c) => {
    try { return c.json(await invokeRead(c, 'xopc.notes.project_summaries', {})); }
    catch (error) { return capabilityHttpError(c, error); }
  });

  // POST /api/notes — full create (JSON or multipart)
  authenticated.post('/api/notes', async (c) => {
    try {
      const contentType = c.req.header('content-type') || '';
      const idempotencyKey = readIdempotencyKey(c.req.header('idempotency-key'));
      if (idempotencyKey && idempotencyKey.length > 200) {
        return c.json({ error: 'Idempotency-Key is too long' }, 400);
      }

      if (contentType.includes('multipart/form-data')) {
        let body: Record<string, unknown>;
        try {
          body = await c.req.parseBody({ all: true });
        } catch {
          return c.json({ error: 'Invalid multipart body' }, 400);
        }

        const markdown = typeof body.markdown === 'string' ? body.markdown.trim() : undefined;
        const kindRaw = typeof body.kind === 'string' ? body.kind : undefined;
        const tagsRaw = typeof body.tags === 'string' ? body.tags : undefined;
        const source = parseCaptureSource(body as Record<string, unknown>);
        const projectId = typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : undefined;
        if (projectId && !service.projects.get(projectId)) return c.json({ error: 'Project not found' }, 400);

        const { note } = await invokeNote(c, 'xopc.notes.create', {
          markdown,
          kind: kindRaw && VALID_KINDS.has(kindRaw as NoteKind) ? (kindRaw as NoteKind) : undefined,
          tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
          capturedVia: source,
          projectId,
        }, idempotencyKey);

        const file = body.file;
        if (file && typeof file === 'object') {
          let buf: Buffer | null = null;
          let fileName = 'upload';
          let mimeType = 'application/octet-stream';

          if (file instanceof File) {
            buf = Buffer.from(await file.arrayBuffer());
            fileName = file.name || fileName;
            mimeType = file.type || mimeType;
          } else if (typeof (file as Blob).arrayBuffer === 'function') {
            buf = Buffer.from(await (file as Blob).arrayBuffer());
          }

          if (buf) {
            const durationRaw = body.duration;
            const duration =
              typeof durationRaw === 'string'
                ? parseInt(durationRaw, 10)
                : typeof durationRaw === 'number'
                  ? durationRaw
                  : undefined;
            await service.notesServiceInstance.addAttachment(note.id, {
              name: fileName,
              buffer: buf,
              mimeType,
              duration: Number.isFinite(duration) ? duration : undefined,
              retainWithoutReference: kindRaw === 'voice',
            }, idempotencyKey);
          }
        }

        const full = await service.notesServiceInstance.getNote(note.id);
        return c.json({ note: full }, 201);
      }

      // JSON body
      const body = await c.req.json().catch(() => ({}));
      const title = typeof body.title === 'string' ? body.title.trim() : undefined;
      const markdown = typeof body.markdown === 'string' ? body.markdown.trim() : undefined;
      const kindRaw = typeof body.kind === 'string' ? body.kind : undefined;
      const tagsRaw = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : undefined;
      const source = parseCaptureSource(body);
      const projectId = typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : undefined;
      if (projectId && !service.projects.get(projectId)) return c.json({ error: 'Project not found' }, 400);

      const { note } = await invokeNote(c, 'xopc.notes.create', {
        title,
        markdown,
        kind: kindRaw && VALID_KINDS.has(kindRaw as NoteKind) ? (kindRaw as NoteKind) : undefined,
        tags: tagsRaw,
        capturedVia: source,
        pinned: body.pinned === true,
        projectId,
      }, idempotencyKey);
      return c.json({ note }, 201);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  // POST /api/notes/sync — local-first markdown sync with optimistic conflict check
  authenticated.post('/api/notes/sync', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const noteId = typeof body.noteId === 'string' ? body.noteId : '';
    if (!noteId) {
      return c.json({ error: 'Missing required field: noteId' }, 400);
    }

    const baseRemoteVersion = typeof body.baseRemoteVersion === 'number' ? body.baseRemoteVersion : undefined;
    const patch = buildNotePatch(body);
    const result = await service.notesServiceInstance.syncNote(noteId, patch, baseRemoteVersion);
    if (!result.note) {
      return c.json(noteNotFound(), 404);
    }
    if (result.conflict) {
      return c.json({ conflict: true, note: result.note }, 409);
    }
    return c.json({ conflict: false, note: result.note });
  });

  // POST /api/notes/:id/catalyze — generate an AI catalysis report and write it back
  authenticated.post('/api/notes/:id/catalyze', async (c) => {
    const result = await service.notesServiceInstance.catalyzeNote(c.req.param('id'), service.currentConfig);
    if (!result) {
      return c.json(noteNotFound(), 404);
    }
    return c.json(result);
  });

  // POST /api/notes/:id/catalysis-feedback — record whether the catalysis was useful
  authenticated.post('/api/notes/:id/catalysis-feedback', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const feedback = body.feedback;
    if (feedback !== 'helpful' && feedback !== 'not_helpful' && feedback !== 'neutral') {
      return c.json({ error: 'Invalid feedback' }, 400);
    }
    const note = await service.notesServiceInstance.recordCatalysisFeedback(c.req.param('id'), feedback);
    if (!note) {
      return c.json(noteNotFound(), 404);
    }
    return c.json({ note });
  });

  // POST /api/notes/:id/chat — create or reuse a note-bound web chat thread
  authenticated.post('/api/notes/:id/chat', async (c) => {
    const noteId = c.req.param('id');
    const note = await service.notesServiceInstance.getNote(noteId);
    if (!note) {
      return c.json(noteNotFound(), 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : undefined;
    const project = projectId ? service.projects.get(projectId) : undefined;
    if (projectId && !project) return c.json({ error: 'Project not found' }, 400);
    let agentId =
      typeof body.agentId === 'string' && body.agentId.trim()
        ? body.agentId.trim().toLowerCase()
        : project?.defaultAgentId ?? getDefaultAgentId();
    if (!agentExists(agentId)) {
      agentId = getDefaultAgentId();
    }

    const sourceBinding = {
      kind: 'note' as const,
      sourceId: noteId,
      version: String(note.updatedAt),
      attachedAt: Date.now(),
    };
    const forceNew = body.forceNew === true;
    const existingKey = note.aiDeep?.catalysis?.sourceConversationId;
    if (!forceNew && existingKey) {
      const existingSession = await service.sessions.getSession(existingKey);
      if (existingSession) {
        const meta = await service.sessionIndexInstance.getSessionMetadata(existingKey);
        await service.sessionIndexInstance.updateSessionMetadata(existingKey, {
          ...(projectId ? { projectId } : {}),
          customData: {
            ...(meta?.customData ?? {}),
            genericNewChatShell: false,
            sourceBinding,
          },
        });
        return c.json({ session: existingSession, conversationId: existingKey, reused: true, sourceBinding });
      }
    }

    const peerId = `note_${noteId}_${Date.now()}`;
    const conversationId = resolveConversationId({
      agentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });

    await service.sessionIndexInstance.saveMessages(conversationId, [], {
      metadata: {
        ...(projectId ? { projectId } : {}),
        sourceChannel: 'webchat',
        sourceChatId: `default:direct:${peerId}`,
        sessionType: 'chat',
        hiddenFromSessionList: true,
        routing: {
          agentId,
          source: 'webchat',
          accountId: 'default',
          peerKind: 'direct',
          peerId,
        },
      },
    });

    const meta = await service.sessionIndexInstance.getSessionMetadata(conversationId);
    await service.sessionIndexInstance.updateSessionMetadata(conversationId, {
      ...(projectId ? { projectId } : {}),
      name: noteThreadName(note),
      tags: Array.from(new Set([...(meta?.tags ?? []), 'note'])),
      customData: {
        ...(meta?.customData ?? {}),
        genericNewChatShell: false,
        sourceBinding,
      },
    });

    await service.notesServiceInstance.linkNoteThread(noteId, conversationId);
    const session = await service.sessions.getSession(conversationId);
    return c.json({ session, conversationId, reused: false, sourceBinding }, 201);
  });

  function noteContextStatusPayload(result: NonNullable<Awaited<ReturnType<typeof service.notesServiceInstance.getAgentContextStatus>>>) {
    const artifact = result.artifact;
    return {
      noteUpdatedAt: result.noteUpdatedAt,
      stale: result.stale,
      status: artifact?.status ?? 'failed',
      generatedAt: artifact?.generatedAt,
      tokenEstimate: artifact?.tokenEstimate,
      truncated: artifact?.truncated ?? false,
      attachments: artifact?.attachments ?? [],
    };
  }

  // GET /api/notes/:id/context-status — build/read the Note grounding artifact status
  authenticated.get('/api/notes/:id/context-status', async (c) => {
    const result = await service.notesServiceInstance.getAgentContextStatus(c.req.param('id'), service.currentConfig);
    if (!result) {
      return c.json(noteNotFound(), 404);
    }
    return c.json(noteContextStatusPayload(result));
  });

  // POST /api/notes/:id/context-rebuild — force rebuild media/document understanding artifact
  authenticated.post('/api/notes/:id/context-rebuild', async (c) => {
    const result = await service.notesServiceInstance.getAgentContextStatus(c.req.param('id'), service.currentConfig, true);
    if (!result) {
      return c.json(noteNotFound(), 404);
    }
    return c.json(noteContextStatusPayload(result));
  });

  // GET /api/notes/:id/threads — list chat threads linked to a note
  authenticated.get('/api/notes/:id/threads', async (c) => {
    const noteId = c.req.param('id');
    const keys = await service.notesServiceInstance.listNoteThreads(noteId);
    if (!keys) {
      return c.json(noteNotFound(), 404);
    }
    const sessions = [];
    for (const key of keys) {
      const session = await service.sessions.getSession(key);
      if (session) sessions.push(session);
    }
    return c.json({ items: sessions, total: sessions.length });
  });

  // POST /api/notes/:id/append — append assistant output or selected text back to the note
  authenticated.post('/api/notes/:id/append', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const heading = typeof body.heading === 'string' && body.heading.trim() ? body.heading.trim() : undefined;
    if (!content) {
      return c.json({ error: 'Missing required field: content' }, 400);
    }
    try {
      return c.json(await invokeNote(c, 'xopc.notes.append', { id: c.req.param('id'), content, heading, expectedRevision: body.expectedRevision },
        readIdempotencyKey(c.req.header('idempotency-key'))));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  // GET /api/notes/:id — single note
  authenticated.get('/api/notes/:id', async (c) => {
    try {
      return c.json(await capabilities.call('xopc.notes.get', { id: c.req.param('id') }, capabilityHttpContext(c)));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/notes/:id/shares', async (c) => {
    const note = await service.notesServiceInstance.getNote(c.req.param('id'));
    if (!note) return c.json(noteNotFound(), 404);
    const shares = noteShares();
    const now = Date.now();
    const items = shares.list(note.id).map((record) => {
      const resolved = resolveShareUrl(record.token, shareUrlContext());
      return {
        id: record.id,
        kind: 'note' as const,
        fileName: record.fileName,
        shareUrl: resolved.shareUrl,
        lanUrl: resolved.lanUrl,
        reachability: resolved.reachability,
        reachabilityHint: resolved.reachabilityHint,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        viewCount: record.downloadCount,
        maxViews: record.maxViews,
        revoked: record.revoked,
        expired: now >= new Date(record.expiresAt).getTime(),
        description: record.description ?? null,
        sourceVersion: record.sourceVersion,
        snapshotRevision: record.snapshotRevision,
        attachmentCount: record.attachmentCount,
        stale: note.updatedAt > record.sourceVersion,
      };
    });
    return c.json({ items, total: items.length, noteVersion: note.updatedAt });
  });

  authenticated.post('/api/notes/:id/shares', async (c) => {
    const principalId = getGatewayPrincipal(c).principalId;
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const shares = noteShares();
    try {
      const record = await shares.create(c.req.param('id'), {
        expectedNoteVersion: typeof body.expectedNoteVersion === 'number' ? body.expectedNoteVersion : undefined,
        attachmentIds: Array.isArray(body.attachmentIds)
          ? body.attachmentIds.filter((id): id is string => typeof id === 'string')
          : undefined,
        ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
        maxViews: body.maxViews === null ? null : typeof body.maxViews === 'number' ? body.maxViews : undefined,
        description: typeof body.description === 'string' ? body.description.trim() || undefined : undefined,
        gatewayTokenHash: createHash('sha256').update(principalId, 'utf8').digest('hex').slice(0, 12),
      });
      const resolved = resolveShareUrl(record.token, shareUrlContext());
      return c.json({
        ok: true,
        payload: {
          id: record.id,
          kind: record.kind,
          shareUrl: resolved.shareUrl,
          lanUrl: resolved.lanUrl,
          reachability: resolved.reachability,
          reachabilityHint: resolved.reachabilityHint,
          expiresAt: record.expiresAt,
          maxViews: record.maxViews,
          sourceNoteId: record.sourceNoteId,
          sourceVersion: record.sourceVersion,
          snapshotRevision: record.snapshotRevision,
          attachmentCount: record.attachmentCount,
          fileName: record.fileName,
        },
      }, 201);
    } catch (err) {
      if (err instanceof NoteShareVersionConflictError) {
        return c.json({ ok: false, error: { code: 'note_version_conflict', message: err.message, currentVersion: err.currentVersion } }, 409);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, message === 'Note not found' ? 404 : 400);
    }
  });

  authenticated.post('/api/notes/:id/shares/:shareId/refresh', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const shares = noteShares();
    try {
      const record = await shares.refresh(c.req.param('id'), c.req.param('shareId'), {
        expectedNoteVersion: typeof body.expectedNoteVersion === 'number' ? body.expectedNoteVersion : undefined,
        attachmentIds: Array.isArray(body.attachmentIds)
          ? body.attachmentIds.filter((id): id is string => typeof id === 'string')
          : undefined,
      });
      const resolved = resolveShareUrl(record.token, shareUrlContext());
      return c.json({ ok: true, payload: {
        id: record.id,
        shareUrl: resolved.shareUrl,
        sourceVersion: record.sourceVersion,
        snapshotRevision: record.snapshotRevision,
        attachmentCount: record.attachmentCount,
      } });
    } catch (err) {
      if (err instanceof NoteShareVersionConflictError) {
        return c.json({ ok: false, error: { code: 'note_version_conflict', message: err.message, currentVersion: err.currentVersion } }, 409);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, message === 'Note share not found' || message === 'Note not found' ? 404 : 400);
    }
  });

  // PATCH /api/notes/:id — update
  authenticated.patch('/api/notes/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const patch = buildNotePatch(body);
    const trigger: SnapshotTrigger =
      body.trigger === 'ai_edit' || body.trigger === 'sync' || body.trigger === 'restore'
        ? body.trigger
        : 'edit';

    const current = await service.notesServiceInstance.getNote(id);
    if (!current) return c.json(noteNotFound(), 404);
    if (c.req.header('idempotency-key') && body.expectedRevision === undefined) {
      return c.json({ ok: false, error: { code: 'INVALID_INPUT', message: 'Idempotent note updates require expectedRevision from the original read' } }, 400);
    }
    try {
      return c.json(await invokeNote(c, 'xopc.notes.update', {
        id, patch, trigger, expectedRevision: body.expectedRevision ?? current.remoteVersion ?? 1,
      }, readIdempotencyKey(c.req.header('idempotency-key'))));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  // DELETE /api/notes/:id — delete note
  authenticated.delete('/api/notes/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const raw = await c.req.text();
      let body: Record<string, unknown> = {};
      if (raw) {
        try { body = JSON.parse(raw); } catch { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CapabilityError('INVALID_INPUT', 'Expected an object');
      }
      const key = readIdempotencyKey(c.req.header('idempotency-key'));
      if (key && body.expectedRevision === undefined) throw new CapabilityError('INVALID_INPUT', 'Stable retries require the original expectedRevision');
      let expectedRevision = body.expectedRevision;
      if (expectedRevision === undefined) {
        const note = await service.notesServiceInstance.getNote(id);
        if (!note) throw new CapabilityError('NOT_FOUND', 'Note not found');
        expectedRevision = note.remoteVersion ?? 1;
      }
      const caller = capabilityHttpContext(c);
      const operation = 'xopc.notes.delete';
      return c.json(NoteDeleteOutputSchema.parse(await capabilities.call(operation, { ...body, id, expectedRevision }, caller,
        { ...capabilities.describe(operation, caller), idempotencyKey: key ?? randomUUID() })));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  // GET /api/notes/:id/history — list version snapshots
  authenticated.get('/api/notes/:id/history', async (c) => {
    try { return c.json(await invokeRead(c, 'xopc.notes.history', { id: c.req.param('id') })); }
    catch (error) { return capabilityHttpError(c, error); }
  });

  // GET /api/notes/:id/history/:timestamp — get full snapshot
  authenticated.get('/api/notes/:id/history/:timestamp', async (c) => {
    try { return c.json(await invokeRead(c, 'xopc.notes.snapshot', { id: c.req.param('id'), timestamp: Number(c.req.param('timestamp')) })); }
    catch (error) { return capabilityHttpError(c, error); }
  });

  // POST /api/notes/:id/history/restore — restore a snapshot
  authenticated.post('/api/notes/:id/history/restore', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const timestamp = typeof body.timestamp === 'number' ? body.timestamp : 0;
    if (!timestamp) {
      return c.json({ error: 'Missing required field: timestamp' }, 400);
    }
    const current = await service.notesServiceInstance.getNote(id);
    if (!current) return c.json(noteNotFound(), 404);
    if (c.req.header('idempotency-key') && body.expectedRevision === undefined) {
      return c.json({ ok: false, error: { code: 'INVALID_INPUT', message: 'Idempotent restore requires expectedRevision from the original read' } }, 400);
    }
    try {
      return c.json(await invokeNote(c, 'xopc.notes.restore', { id, timestamp, expectedRevision: body.expectedRevision ?? current.remoteVersion ?? 1 },
        readIdempotencyKey(c.req.header('idempotency-key'))));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  // POST /api/notes/:id/ai/edit — generate previewable markdown AI patch
  authenticated.post('/api/notes/:id/ai/edit', async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); });
      return c.json(await capabilities.call('xopc.notes.preview_edit', { ...body, id: c.req.param('id') }, capabilityHttpContext(c)));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  // POST /api/notes/:id/media — upload attachment to existing note
  authenticated.post('/api/notes/:id/media', async (c) => {
    const noteId = c.req.param('id');
    const idempotencyKey = readIdempotencyKey(c.req.header('idempotency-key'));
    if (idempotencyKey && idempotencyKey.length > 200) {
      return c.json({ error: 'Idempotency-Key is too long' }, 400);
    }
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody({ all: true });
    } catch {
      return c.json({ error: 'Invalid multipart body' }, 400);
    }

    const file = body.file;
    if (!file || typeof file !== 'object') {
      return c.json({ error: 'Missing file field' }, 400);
    }

    let buf: Buffer;
    let fileName = 'upload';
    let mimeType = 'application/octet-stream';

    if (file instanceof File) {
      buf = Buffer.from(await file.arrayBuffer());
      fileName = file.name || fileName;
      mimeType = file.type || mimeType;
    } else if (typeof (file as Blob).arrayBuffer === 'function') {
      buf = Buffer.from(await (file as Blob).arrayBuffer());
    } else {
      return c.json({ error: 'Invalid file upload' }, 400);
    }

    const durationRaw = body.duration;
    const duration = typeof durationRaw === 'string' ? parseInt(durationRaw, 10) : undefined;

    const attachment = await service.notesServiceInstance.addAttachment(noteId, {
      name: fileName,
      buffer: buf,
      mimeType,
      duration: Number.isFinite(duration) ? duration : undefined,
    }, idempotencyKey);

    if (!attachment) {
      return c.json(noteNotFound(), 404);
    }
    return c.json({ attachment }, 201);
  });

  // GET /api/notes/:id/media/:attachmentId — serve attachment file
  authenticated.get('/api/notes/:id/media/:attachmentId', async (c) => {
    const noteId = c.req.param('id');
    const attachmentId = c.req.param('attachmentId');

    const result = await service.notesServiceInstance.getAttachmentPath(noteId, attachmentId);
    if (!result) {
      return c.json({ error: 'Attachment not found' }, 404);
    }

    const { filePath, mimeType, fileName } = result;

    try {
      await access(filePath);
    } catch {
      return c.json({ error: 'Attachment file missing' }, 404);
    }

    const fileStat = await stat(filePath);

    c.header('Content-Type', mimeType);
    c.header('Content-Length', String(fileStat.size));
    c.header('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');

    return stream(c, async (s) => {
      const readable = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
      await s.pipe(readable);
    });
  });

  // ── Task / Space / Open tracking ────────────────────────────────────

  authenticated.post('/api/notes/task', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return c.json({ error: 'Missing required field: title' }, 400);

    const source = parseCaptureSource(body);
    const note = await service.notesServiceInstance.createTask(title, source, {
      dueAt: typeof body.dueAt === 'number' ? body.dueAt : undefined,
      priority: body.priority === 'high' || body.priority === 'medium' || body.priority === 'low' ? body.priority : undefined,
      sourceConversationId: typeof body.sourceConversationId === 'string' ? body.sourceConversationId : undefined,
      sourceNoteId: typeof body.sourceNoteId === 'string' ? body.sourceNoteId : undefined,
      groupId: typeof body.groupId === 'string' ? body.groupId : undefined,
    });
    return c.json({ note }, 201);
  });

  authenticated.post('/api/notes/:id/toggle-done', async (c) => {
    const note = await service.notesServiceInstance.toggleTaskDone(c.req.param('id'));
    if (!note) return c.json({ error: 'Not found or not a task' }, 404);
    return c.json({ note });
  });

  authenticated.post('/api/notes/:id/open', async (c) => {
    const note = await service.notesServiceInstance.recordOpen(c.req.param('id'));
    if (!note) return c.json({ error: 'Not found' }, 404);
    return c.json({ note });
  });

  authenticated.post('/api/notes/:id/move', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const groupId = typeof body.groupId === 'string' ? body.groupId : null;
    const note = await service.notesServiceInstance.moveToGroup(c.req.param('id'), groupId);
    if (!note) return c.json({ error: 'Not found' }, 404);
    return c.json({ note });
  });
}
