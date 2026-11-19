import { stat } from 'node:fs/promises';

import type { Hono } from 'hono';

import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { issueMediaPlaybackTicket } from '../../security/media-playback-ticket.js';

import { resolveScopedMediaReference } from '../../media-access.js';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '../../chat-limits.js';
import { fileRangeResponse } from '../../../media-shared/http/file-response.js';
import { MEDIA_ARTIFACT_MAX_BYTES, mimeTypeFromMediaPath, saveMediaBuffer } from '../../../media/store.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('Media');

export function registerMediaRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.post('/api/media/playback-ticket', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json<{ path?: unknown }>().catch(() => null);
    if (typeof body?.path !== 'string') return c.json({ error: 'Missing media path' }, 400);
    const path = issueMediaPlaybackTicket(body.path, getGatewayPrincipal(c));
    if (!path) return c.json({ error: 'Playback is unavailable for this resource' }, 403);
    return c.json({ path }, 201, { 'Cache-Control': 'no-store' });
  });

  authenticated.post('/api/media', deps.strictRateLimitMiddleware, async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof Blob)) {
      return c.json({ ok: false, error: { message: 'Missing required file field: file' } }, 400);
    }
    if (file.size === 0) {
      return c.json({ ok: false, error: { message: 'Uploaded file is empty' } }, 400);
    }
    if (file.size > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) {
      return c.json({ ok: false, error: { message: 'Uploaded file exceeds 32 MB limit' } }, 413);
    }
    const name = 'name' in file && typeof file.name === 'string' && file.name.trim()
      ? file.name.trim()
      : `upload-${Date.now()}`;
    const saved = await saveMediaBuffer(Buffer.from(await file.arrayBuffer()), {
      bucket: 'inbound',
      contentType: file.type || 'application/octet-stream',
      maxBytes: MAX_WEBCHAT_ATTACHMENT_FILE_BYTES,
      originalFilename: name,
    });
    return c.json({
      ok: true,
      payload: {
        uri: saved.uri,
        mimeType: saved.contentType,
        name,
        size: saved.size,
      },
    }, 201);
  });

  authenticated.get('/api/media/read', async (c) => {
    const uriRaw = c.req.query('uri');
    if (!uriRaw || typeof uriRaw !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing uri' } }, 400);
    }
    const conversationId = c.req.query('conversationId');
    const taskId = c.req.query('taskId');
    if (!conversationId && !taskId) {
      return c.json({ ok: false, error: { message: 'Missing media scope' } }, 400);
    }
    try {
      const parsed = await resolveScopedMediaReference(deps.service, uriRaw.trim(), { conversationId, taskId });
      const { path, bucket } = parsed;
      const file = await stat(path);
      const maxBytes = bucket === 'outbound' ? MEDIA_ARTIFACT_MAX_BYTES : MAX_WEBCHAT_ATTACHMENT_FILE_BYTES;
      if (!file.isFile() || file.size > maxBytes) throw new Error('Media unavailable');
      return fileRangeResponse(path, file.size, c.req.header('Range'), {
        'Cache-Control': 'private, max-age=3600',
        'Content-Type': mimeTypeFromMediaPath(path),
      }, c.req.method === 'HEAD');
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, uri: uriRaw, errorMessage: em }, `Media read failed: ${em}`);
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
  });
}
