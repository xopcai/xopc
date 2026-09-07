import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { registerNotesRoutes } from '../notes.js';

describe('notes routes', () => {
  it('forwards home filters and returns project summaries before the note-id route', async () => {
    const app = new Hono();
    const listNotes = vi.fn().mockResolvedValue({ items: [], total: 0 });
    registerNotesRoutes(app, {
      service: { notesServiceInstance: { listNotes, listProjectSummaries: () => [{ id: 'p1', noteCount: 4 }] } },
    } as never);
    await app.request('/api/notes?unassigned=true&agentEdited=true&pinned=true&offset=12&sortBy=updatedAt');
    expect(listNotes).toHaveBeenCalledWith(expect.objectContaining({ unassigned: true, agentEdited: true, pinned: true, offset: 12, sortBy: 'updatedAt' }));
    const summary = await app.request('/api/notes/project-summaries');
    expect(await summary.json()).toEqual({ items: [{ id: 'p1', noteCount: 4 }] });
  });

  it('forwards attachment idempotency keys so retries reuse the same media', async () => {
    const app = new Hono();
    const addAttachment = vi.fn().mockResolvedValue({ id: 'attachment-1' });
    registerNotesRoutes(app, { service: { notesServiceInstance: { addAttachment } } } as never);
    const body = new FormData();
    body.append('file', new File(['material'], 'source.txt', { type: 'text/plain' }));
    const res = await app.request('/api/notes/note-1/media', {
      method: 'POST', headers: { 'idempotency-key': 'draft:file:0' }, body,
    });
    expect(res.status).toBe(201);
    expect(addAttachment).toHaveBeenCalledWith('note-1', expect.objectContaining({ name: 'source.txt' }), 'draft:file:0');
  });

  it('uses a selected project agent and binds the note conversation to the project', async () => {
    const app = new Hono();
    const updateSessionMetadata = vi.fn();
    const saveMessages = vi.fn();
    registerNotesRoutes(app, { service: {
      currentConfig: { agents: { default: 'main', list: [{ id: 'main', enabled: true }, { id: 'writer', enabled: true }] } },
      projects: { get: (id: string) => id === 'p1' ? { id, defaultAgentId: 'writer' } : undefined },
      notesServiceInstance: { getNote: async () => ({ id: 'n1', markdown: 'Draft', updatedAt: 2 }), linkNoteThread: vi.fn() },
      sessionIndexInstance: { saveMessages, getSessionMetadata: async () => ({}), updateSessionMetadata },
      sessions: { getSession: async (key: string) => ({ key }) },
    } } as never);
    const res = await app.request('/api/notes/n1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'p1' }) });
    expect(res.status).toBe(201);
    expect(saveMessages).toHaveBeenCalledWith(expect.stringContaining('writer'), [], expect.objectContaining({ metadata: expect.objectContaining({ projectId: 'p1' }) }));
    expect(updateSessionMetadata).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ projectId: 'p1', customData: expect.objectContaining({ sourceBinding: expect.objectContaining({ sourceId: 'n1' }) }) }));
    const missing = await app.request('/api/notes/n1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'missing' }) });
    expect(missing.status).toBe(400);
    expect(saveMessages).toHaveBeenCalledTimes(1);
  });

  it('forwards the quick capture idempotency key to the notes service', async () => {
    const app = new Hono();
    const quickCapture = vi.fn().mockResolvedValue({ id: 'note-1' });
    registerNotesRoutes(app, {
      service: {
        notesServiceInstance: { quickCapture },
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const res = await app.request('/api/notes/quick-capture', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'capture-request-1',
      },
      body: JSON.stringify({ text: 'Remember this', channel: 'app', platform: 'android' }),
    });

    expect(res.status).toBe(201);
    expect(quickCapture).toHaveBeenCalledWith(
      'Remember this',
      { channel: 'app', platform: 'android' },
      'capture-request-1',
    );
  });

  it('forwards the full capture idempotency key to the notes service', async () => {
    const app = new Hono();
    const createNote = vi.fn().mockResolvedValue({ id: 'note-voice', markdown: '', attachments: [] });
    registerNotesRoutes(app, {
      service: {
        projects: { get: vi.fn() },
        notesServiceInstance: { createNote },
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const res = await app.request('/api/notes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'voice-request-1',
      },
      body: JSON.stringify({ kind: 'voice', channel: 'app', platform: 'ios' }),
    });

    expect(res.status).toBe(201);
    expect(createNote).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'voice',
      capturedVia: { channel: 'app', platform: 'ios' },
    }), 'voice-request-1');
  });

  it('returns a stable note_not_found code when patching a missing note', async () => {
    const app = new Hono();
    registerNotesRoutes(app, {
      service: {
        notesServiceInstance: {
          updateNote: vi.fn().mockResolvedValue(null),
        },
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const res = await app.request('/api/notes/missing-note', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markdown: 'local draft' }),
    });

    await expect(res.json()).resolves.toEqual({
      error: 'Note not found',
      code: 'note_not_found',
    });
    expect(res.status).toBe(404);
  });

  it('marks note chat sessions as non-generic new-chat shells', async () => {
    const app = new Hono();
    const updateSessionMetadata = vi.fn(async () => undefined);
    const linkNoteThread = vi.fn(async () => undefined);
    const saveMessages = vi.fn(async () => undefined);
    registerNotesRoutes(app, {
      service: {
        currentConfig: {
          agents: {
            default: 'main',
            list: [{ id: 'main', enabled: true }],
          },
        },
        notesServiceInstance: {
          getNote: vi.fn().mockResolvedValue({
            id: 'note-1',
            kind: 'thought',
            status: 'inbox',
            markdown: 'hello note',
            createdAt: 1,
            updatedAt: 2,
            capturedVia: { channel: 'web' },
          }),
          linkNoteThread,
        },
        sessionIndexInstance: {
          saveMessages,
          getSessionMetadata: vi.fn(async () => ({ customData: { existing: true }, tags: [] })),
          updateSessionMetadata,
        },
        sessions: {
          getSession: vi.fn(async (key: string) => ({ key })),
        },
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const res = await app.request('/api/notes/note-1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forceNew: true }),
    });

    expect(res.status).toBe(201);
    expect(saveMessages).toHaveBeenCalledWith(
      expect.stringContaining(':direct:note_note-1_'),
      [],
      expect.objectContaining({
        metadata: expect.objectContaining({
          hiddenFromSessionList: true,
        }),
      }),
    );
    expect(updateSessionMetadata).toHaveBeenCalledWith(
      expect.stringContaining(':direct:note_note-1_'),
      expect.objectContaining({
        customData: expect.objectContaining({
          existing: true,
          genericNewChatShell: false,
          sourceBinding: expect.objectContaining({ kind: 'note', sourceId: 'note-1', version: '2' }),
        }),
      }),
    );
    expect(linkNoteThread).toHaveBeenCalledWith('note-1', expect.stringContaining(':direct:note_note-1_'));
  });
});
