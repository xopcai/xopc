import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { registerNotesRoutes } from '../notes.js';

describe('notes routes', () => {
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
