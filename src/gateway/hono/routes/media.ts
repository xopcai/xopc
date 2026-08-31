import type { Hono } from 'hono';

import { pendingTranscriptReferencesMediaUri } from '../../../agent/inbound/attachment-pipeline.js';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '../../chat-limits.js';
import { readMediaReference } from '../../../media/media-reference.js';
import { messagesReferenceMediaUri } from '../../../media/session-references.js';
import { parseMediaUri } from '../../../media/uri.js';
import { mimeTypeFromMediaPath, saveMediaBuffer } from '../../../media/store.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskContextRepository } from '../../../tasks/task-context-repository.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('Media');

export function registerMediaRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const tasks = new TaskRepository();

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
    const sessionKey = c.req.query('sessionKey');
    const taskId = c.req.query('taskId');
    if (!sessionKey && !taskId) {
      return c.json({ ok: false, error: { message: 'Missing media scope' } }, 400);
    }
    try {
      const parsed = parseMediaUri(uriRaw.trim());
      const sessionReferencesUri = sessionKey
        ? messagesReferenceMediaUri(
          await deps.service.sessionIndexInstance.loadMessages(sessionKey),
          parsed.uri,
        ) || pendingTranscriptReferencesMediaUri(sessionKey, parsed.uri)
        : false;
      const taskReferencesUri = taskId && tasks.get(taskId)
        ? new TaskContextRepository().list(taskId)
          .some((edge) => edge.targetKind === 'file' && edge.targetId === parsed.uri)
        : false;
      if (!sessionReferencesUri && !taskReferencesUri) {
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
