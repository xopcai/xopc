import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../../service.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerChatPreviewRoutes } from '../chat-previews.js';

const ID = '9b30807b-99f2-4d3e-9306-9aa1800d1dc0';
const HASH = 'a'.repeat(64);

function appFor(chatPreviews: object): Hono {
  const app = new Hono();
  registerChatPreviewRoutes(app, {
    service: { chatPreviews } as unknown as GatewayService,
  } as AuthenticatedRouteDeps);
  return app;
}

describe('chat preview routes', () => {
  it('serves immutable revisions with immutable cache headers', async () => {
    const app = appFor({
      getRevision: () => ({ previewId: ID, sourceHash: HASH, markup: '<main />', styles: '', script: '', createdAt: 1 }),
    });
    const response = await app.request(`/api/chat-previews/${ID}/revisions/${HASH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(await response.json()).toMatchObject({ revision: { previewId: ID, sourceHash: HASH } });
  });

  it('validates fix diagnostics and promotes the exact requested revision', async () => {
    const getFixGuidance = vi.fn(() => ({ previewId: ID, sourceHash: HASH, prompt: 'fix it' }));
    const promote = vi.fn(() => ({ id: 'app-1' }));
    const app = appFor({ getFixGuidance, promote });
    const fix = await app.request(`/api/chat-previews/${ID}/fix-guidance`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceHash: HASH, locale: 'en', diagnostics: [{ kind: 'script_error', message: 'boom' }] }),
    });
    const promoted = await app.request(`/api/chat-previews/${ID}/promote`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceHash: HASH }),
    });

    expect(fix.status).toBe(200);
    expect(getFixGuidance).toHaveBeenCalledWith(ID, HASH, [{ kind: 'script_error', message: 'boom' }], 'en');
    expect(promoted.status).toBe(201);
    expect(promote).toHaveBeenCalledWith(ID, HASH);
  });

  it('rejects malformed hashes before calling the service', async () => {
    const getRevision = vi.fn();
    const app = appFor({ getRevision });
    const response = await app.request(`/api/chat-previews/${ID}/revisions/not-a-hash`);
    expect(response.status).toBe(400);
    expect(getRevision).not.toHaveBeenCalled();
  });
});
