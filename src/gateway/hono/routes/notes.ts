import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import type { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { CaptureChannel, CaptureSource, Note, NoteBlock, NoteKind, NoteStatus } from '../../../notes/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const VALID_KINDS = new Set<NoteKind>(['thought', 'todo', 'voice', 'media', 'bookmark', 'mixed']);
const VALID_STATUSES = new Set<NoteStatus>(['inbox', 'processed', 'archived', 'trashed']);
const VALID_CHANNELS = new Set<CaptureChannel>(['app', 'web', 'electron', 'tui', 'telegram', 'wechat', 'feishu']);

function parseCaptureSource(body: Record<string, unknown>): CaptureSource {
  const channel = typeof body.channel === 'string' && VALID_CHANNELS.has(body.channel as CaptureChannel)
    ? (body.channel as CaptureChannel)
    : 'web';
  const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : undefined;
  return { channel, platform };
}

function parseBlocks(value: unknown): NoteBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((block): block is NoteBlock => {
    if (!block || typeof block !== 'object') return false;
    const candidate = block as Record<string, unknown>;
    return typeof candidate.id === 'string' && typeof candidate.type === 'string';
  });
}

function buildNotePatch(body: Record<string, unknown>): Partial<Note> {
  const patch: Partial<Note> = {};
  if (typeof body.text === 'string') patch.text = body.text;
  if (Array.isArray(body.blocks)) patch.blocks = parseBlocks(body.blocks);
  if (typeof body.kind === 'string' && VALID_KINDS.has(body.kind as NoteKind)) patch.kind = body.kind as NoteKind;
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status as NoteStatus)) patch.status = body.status as NoteStatus;
  if (Array.isArray(body.tags)) patch.tags = body.tags.filter((tag): tag is string => typeof tag === 'string');
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
  if (typeof body.localVersion === 'number') patch.localVersion = body.localVersion;
  if (body.ai && typeof body.ai === 'object') patch.ai = body.ai as Note['ai'];
  if (body.aiDeep && typeof body.aiDeep === 'object') patch.aiDeep = body.aiDeep as Note['aiDeep'];
  return patch;
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
    const note = await service.notesServiceInstance.quickCapture(text, source);
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
    const sortBy = c.req.query('sortBy') as 'createdAt' | 'updatedAt' | undefined;
    const sortOrder = c.req.query('sortOrder') as 'asc' | 'desc' | undefined;

    const result = await service.notesServiceInstance.listNotes({
      status: status && VALID_STATUSES.has(status) ? status : undefined,
      kind: kind && VALID_KINDS.has(kind) ? kind : undefined,
      tag: tag || undefined,
      search: search || undefined,
      pinned: pinnedRaw === 'true' ? true : pinnedRaw === 'false' ? false : undefined,
      limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
      offset: offsetRaw ? parseInt(offsetRaw, 10) : undefined,
      sortBy: sortBy === 'createdAt' || sortBy === 'updatedAt' ? sortBy : undefined,
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

      const text = typeof body.text === 'string' ? body.text.trim() : undefined;
      const kindRaw = typeof body.kind === 'string' ? body.kind : undefined;
      const tagsRaw = typeof body.tags === 'string' ? body.tags : undefined;
      const source = parseCaptureSource(body as Record<string, unknown>);

      const note = await service.notesServiceInstance.createNote({
        text,
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
          await service.notesServiceInstance.addAttachment(note.id, {
            name: fileName,
            buffer: buf,
            mimeType,
          });
        }
      }

      const full = await service.notesServiceInstance.getNote(note.id);
      return c.json({ note: full }, 201);
    }

    // JSON body
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim() : undefined;
    const blocks = parseBlocks(body.blocks);
    const kindRaw = typeof body.kind === 'string' ? body.kind : undefined;
    const tagsRaw = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : undefined;
    const source = parseCaptureSource(body);

    const note = await service.notesServiceInstance.createNote({
      text,
      blocks,
      kind: kindRaw && VALID_KINDS.has(kindRaw as NoteKind) ? (kindRaw as NoteKind) : undefined,
      tags: tagsRaw,
      capturedVia: source,
      pinned: body.pinned === true,
    });
    return c.json({ note }, 201);
  });

  // POST /api/notes/sync — local-first block sync with optimistic conflict check
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
      return c.json({ error: 'Note not found' }, 404);
    }
    if (result.conflict) {
      return c.json({ conflict: true, note: result.note }, 409);
    }
    return c.json({ conflict: false, note: result.note });
  });

  // GET /api/notes/:id — single note
  authenticated.get('/api/notes/:id', async (c) => {
    const id = c.req.param('id');
    const note = await service.notesServiceInstance.getNote(id);
    if (!note) {
      return c.json({ error: 'Note not found' }, 404);
    }
    return c.json({ note });
  });

  // PATCH /api/notes/:id — update
  authenticated.patch('/api/notes/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const patch = buildNotePatch(body);

    const updated = await service.notesServiceInstance.updateNote(id, patch);
    if (!updated) {
      return c.json({ error: 'Note not found' }, 404);
    }
    return c.json({ note: updated });
  });

  // DELETE /api/notes/:id — delete note
  authenticated.delete('/api/notes/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await service.notesServiceInstance.deleteNote(id);
    if (!removed) {
      return c.json({ error: 'Note not found' }, 404);
    }
    return c.json({ deleted: true });
  });

  // POST /api/notes/:id/ai/edit — generate previewable block-level AI patch
  authenticated.post('/api/notes/:id/ai/edit', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!instruction) {
      return c.json({ error: 'Missing required field: instruction' }, 400);
    }

    const blocks = parseBlocks(body.blocks);
    const result = await service.notesServiceInstance.createAiEditPatch(id, instruction, blocks);
    if (!result) {
      return c.json({ error: 'Note not found' }, 404);
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
      return c.json({ error: 'Note not found' }, 404);
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
}
