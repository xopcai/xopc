import type { Hono } from 'hono';

import { pendingTranscriptReferencesMediaUri } from '../../../agent/inbound/attachment-pipeline.js';
import { readMediaReference } from '../../../media/media-reference.js';
import { messagesReferenceMediaUri } from '../../../media/session-references.js';
import { parseMediaUri } from '../../../media/uri.js';
import { mimeTypeFromMediaPath } from '../../../media/store.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('Media');

export function registerMediaRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/media/read', async (c) => {
    const uriRaw = c.req.query('uri');
    if (!uriRaw || typeof uriRaw !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing uri' } }, 400);
    }
    const sessionKey = c.req.query('sessionKey');
    if (!sessionKey || typeof sessionKey !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing sessionKey' } }, 400);
    }
    try {
      const parsed = parseMediaUri(uriRaw.trim());
      const messages = await deps.service.sessionIndexInstance.loadMessages(sessionKey);
      if (
        !messagesReferenceMediaUri(messages, parsed.uri) &&
        !pendingTranscriptReferencesMediaUri(sessionKey, parsed.uri)
      ) {
        return c.json({ ok: false, error: { message: 'Not found' } }, 404);
      }
      const { buffer, path } = await readMediaReference(parsed.uri);
      const contentType = mimeTypeFromMediaPath(path);
      return new Response(buffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, uri: uriRaw, errorMessage: em }, `Media read failed: ${em}`);
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
  });
}
