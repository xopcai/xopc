import {
  ChatPreviewFixGuidanceInputSchema,
  ChatPreviewSourceHashSchema,
} from '@xopcai/gateway-contract';
import type { Hono } from 'hono';

import { ChatPreviewNotFoundError } from '../../../chat-previews/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerChatPreviewRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get('/api/chat-previews/:id/revisions/:sourceHash', (c) => {
    const sourceHash = ChatPreviewSourceHashSchema.safeParse(c.req.param('sourceHash'));
    if (!sourceHash.success) return c.json({ error: 'Invalid preview revision' }, 400);
    try {
      return c.json({
        revision: deps.service.chatPreviews.getRevision(c.req.param('id'), sourceHash.data),
      }, 200, {
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
    } catch (error) {
      if (error instanceof ChatPreviewNotFoundError) return c.json({ error: error.message }, 404);
      throw error;
    }
  });

  app.post('/api/chat-previews/:id/fix-guidance', async (c) => {
    const parsed = ChatPreviewFixGuidanceInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid fix guidance input' }, 400);
    try {
      return c.json({
        guidance: deps.service.chatPreviews.getFixGuidance(
          c.req.param('id'),
          parsed.data.sourceHash,
          parsed.data.diagnostics,
          parsed.data.locale,
        ),
      });
    } catch (error) {
      if (error instanceof ChatPreviewNotFoundError) return c.json({ error: error.message }, 404);
      throw error;
    }
  });

  app.post('/api/chat-previews/:id/promote', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const sourceHash = ChatPreviewSourceHashSchema.safeParse(body?.sourceHash);
    if (!sourceHash.success) return c.json({ error: 'Invalid preview revision' }, 400);
    try {
      return c.json({
        app: deps.service.chatPreviews.promote(c.req.param('id'), sourceHash.data),
      }, 201);
    } catch (error) {
      if (error instanceof ChatPreviewNotFoundError) return c.json({ error: error.message }, 404);
      throw error;
    }
  });
}
