import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { registerNotesRoutes } from '../notes.js';

describe('notes routes', () => {
  it('returns a stable note_not_found code when patching a missing note', async () => {
    const app = new Hono();
    registerNotesRoutes(app, {
      service: {
        notesServiceInstance: {
          updateNote: vi.fn().mockResolvedValue(null),
        },
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
      sseConfig: {},
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
});
