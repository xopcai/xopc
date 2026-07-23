import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import type { Hono } from 'hono';
import { stream } from 'hono/streaming';

import { buildSessionKey } from '../../../routing/session-key.js';
import { agentExists, getDefaultAgentId } from '../../../routing/resolve-route.js';
import type { CaptureChannel, CaptureSource, Note, NoteKind, NoteStatus, SnapshotTrigger } from '../../../notes/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const VALID_KINDS = new Set<NoteKind>(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed', 'task']);
const VALID_STATUSES = new Set<NoteStatus>(['inbox', 'processed', 'archived', 'trashed']);
const VALID_CHANNELS = new Set<CaptureChannel>(['app', 'web', 'electron', 'tui', 'telegram', 'wechat', 'feishu']);

function noteNotFound() {
  return { error: 'Note not found', code: 'note_not_found' };
}

function parseCaptureSource(body: Record<string, unknown>): CaptureSource {
  const channel = typeof body.channel === 'string' && VALID_CHANNELS.has(body.channel as CaptureChannel)
    ? (body.channel as CaptureChannel)
    : 'web';
  const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : undefined;
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

  // POST /api/notes/quick-capture — minimal text capture
  authenticated.post('/api/notes/quick-capture', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return c.json({ error: 'Missing required field: text' }, 400);
    }
    const source = parseCaptureSource(body);
    const idempotencyKey = c.req.header('idempotency-key')?.trim();
    if (idempotencyKey && idempotencyKey.length > 200) {
      return c.json({ error: 'Idempotency-Key is too long' }, 400);
    }
    const note = await service.notesServiceInstance.quickCapture(text, source, idempotencyKey || undefined);
    return c.json({ note }, 201);
  });

  // GET /api/notes — list with filters
  authenticated.get('/api/notes', async (c) => {
    const status = c.req.query('status') as NoteStatus | undefined;
    const kind = c.req.query('kind') as NoteKind | undefined;
    const tag = c.req.query('tag');
    const search = c.req.query('search');
    const pinnedRaw = c.req.query('pinned');
    const limitRaw = c.req.query('limit');
    const offsetRaw = c.req.query('offset');
    const sortBy = c.req.query('sortBy') as 'createdAt' | 'updatedAt' | 'lastOpenedAt' | undefined;
    const sortOrder = c.req.query('sortOrder') as 'asc' | 'desc' | undefined;

    const result = await service.notesServiceInstance.listNotes({
      status: status && VALID_STATUSES.has(status) ? status : undefined,
      kind: kind && VALID_KINDS.has(kind) ? kind : undefined,
      tag: tag || undefined,
      search: search || undefined,
      pinned: pinnedRaw === 'true' ? true : pinnedRaw === 'false' ? false : undefined,
      limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
      offset: offsetRaw ? parseInt(offsetRaw, 10) : undefined,
      sortBy: sortBy === 'createdAt' || sortBy === 'updatedAt' || sortBy === 'lastOpenedAt' ? sortBy : undefined,
      sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : undefined,
    });
    return c.json(result);
  });

  // POST /api/notes — full create (JSON or multipart)
  authenticated.post('/api/notes', async (c) => {
    const contentType = c.req.header('content-type') || '';

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

      const note = await service.notesServiceInstance.createNote({
        markdown,
        kind: kindRaw && VALID_KINDS.has(kindRaw as NoteKind) ? (kindRaw as NoteKind) : undefined,
        tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        capturedVia: source,
      });

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
          });
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

    const note = await service.notesServiceInstance.createNote({
      title,
      markdown,
      kind: kindRaw && VALID_KINDS.has(kindRaw as NoteKind) ? (kindRaw as NoteKind) : undefined,
      tags: tagsRaw,
      capturedVia: source,
      pinned: body.pinned === true,
    });
    return c.json({ note }, 201);
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
    const routingCfg = service.currentConfig;
    let agentId =
      typeof body.agentId === 'string' && body.agentId.trim()
        ? body.agentId.trim().toLowerCase()
        : getDefaultAgentId(routingCfg);
    if (!agentExists(agentId, routingCfg)) {
      agentId = getDefaultAgentId(routingCfg);
    }

    const sourceBinding = {
      kind: 'note' as const,
      sourceId: noteId,
      version: String(note.updatedAt),
      attachedAt: Date.now(),
    };
    const forceNew = body.forceNew === true;
    const existingKey = note.aiDeep?.catalysis?.sourceSessionKey;
    if (!forceNew && existingKey) {
      const existingSession = await service.sessions.getSession(existingKey);
      if (existingSession) {
        const meta = await service.sessionIndexInstance.getSessionMetadata(existingKey);
        await service.sessionIndexInstance.updateSessionMetadata(existingKey, {
          customData: {
            ...(meta?.customData ?? {}),
            genericNewChatShell: false,
            sourceBinding,
          },
        });
        return c.json({ session: existingSession, sessionKey: existingKey, reused: true, sourceBinding });
      }
    }

    const peerId = `note_${noteId}_${Date.now()}`;
    const sessionKey = buildSessionKey({
      agentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });

    await service.sessionIndexInstance.saveMessages(sessionKey, [], {
      metadata: {
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

    const meta = await service.sessionIndexInstance.getSessionMetadata(sessionKey);
    await service.sessionIndexInstance.updateSessionMetadata(sessionKey, {
      name: noteThreadName(note),
      tags: Array.from(new Set([...(meta?.tags ?? []), 'note'])),
      customData: {
        ...(meta?.customData ?? {}),
        genericNewChatShell: false,
        sourceBinding,
      },
    });

    await service.notesServiceInstance.linkNoteThread(noteId, sessionKey);
    const session = await service.sessions.getSession(sessionKey);
    return c.json({ session, sessionKey, reused: false, sourceBinding }, 201);
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
    const note = await service.notesServiceInstance.appendTextToNote(c.req.param('id'), content, heading);
    if (!note) {
      return c.json(noteNotFound(), 404);
    }
    return c.json({ note });
  });

  // GET /api/notes/:id — single note
  authenticated.get('/api/notes/:id', async (c) => {
    const id = c.req.param('id');
    const note = await service.notesServiceInstance.getNote(id);
    if (!note) {
      return c.json(noteNotFound(), 404);
    }
    return c.json({ note });
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

    const updated = await service.notesServiceInstance.updateNote(id, patch, trigger);
    if (!updated) {
      return c.json(noteNotFound(), 404);
    }
    return c.json({ note: updated });
  });

  // DELETE /api/notes/:id — delete note
  authenticated.delete('/api/notes/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await service.notesServiceInstance.deleteNote(id);
    if (!removed) {
      return c.json(noteNotFound(), 404);
    }
    return c.json({ deleted: true });
  });

  // GET /api/notes/:id/history — list version snapshots
  authenticated.get('/api/notes/:id/history', async (c) => {
    const id = c.req.param('id');
    const entries = await service.notesServiceInstance.listNoteHistory(id);
    return c.json({ entries });
  });

  // GET /api/notes/:id/history/:timestamp — get full snapshot
  authenticated.get('/api/notes/:id/history/:timestamp', async (c) => {
    const id = c.req.param('id');
    const timestamp = parseInt(c.req.param('timestamp'), 10);
    if (!Number.isFinite(timestamp)) {
      return c.json({ error: 'Invalid timestamp' }, 400);
    }
    const snapshot = await service.notesServiceInstance.getNoteSnapshot(id, timestamp);
    if (!snapshot) {
      return c.json({ error: 'Snapshot not found' }, 404);
    }
    return c.json({ snapshot });
  });

  // POST /api/notes/:id/history/restore — restore a snapshot
  authenticated.post('/api/notes/:id/history/restore', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const timestamp = typeof body.timestamp === 'number' ? body.timestamp : 0;
    if (!timestamp) {
      return c.json({ error: 'Missing required field: timestamp' }, 400);
    }
    const note = await service.notesServiceInstance.restoreNoteSnapshot(id, timestamp);
    if (!note) {
      return c.json({ error: 'Snapshot or note not found' }, 404);
    }
    return c.json({ note });
  });

  // POST /api/notes/:id/ai/edit — generate previewable markdown AI patch
  authenticated.post('/api/notes/:id/ai/edit', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!instruction) {
      return c.json({ error: 'Missing required field: instruction' }, 400);
    }

    const markdown = typeof body.markdown === 'string' ? body.markdown : undefined;
    const result = await service.notesServiceInstance.createAiEditPatch(id, instruction, markdown);
    if (!result) {
      return c.json(noteNotFound(), 404);
    }
    return c.json(result);
  });

  // POST /api/notes/:id/media — upload attachment to existing note
  authenticated.post('/api/notes/:id/media', async (c) => {
    const noteId = c.req.param('id');
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
    });

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
      sourceSessionKey: typeof body.sourceSessionKey === 'string' ? body.sourceSessionKey : undefined,
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
