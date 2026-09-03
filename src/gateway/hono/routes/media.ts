import type { Hono } from 'hono';

import { resolveScopedMediaReference } from '../../media-access.js';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '../../chat-limits.js';
import { readMediaReference } from '../../../media/media-reference.js';
import { mimeTypeFromMediaPath, saveMediaBuffer } from '../../../media/store.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('Media');

type ByteRange = { start: number; end: number };

function parseByteRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid';

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) return 'invalid';
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function registerMediaRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
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
      const parsed = await resolveScopedMediaReference(deps.service, uriRaw.trim(), { sessionKey, taskId });
      const { buffer, path } = await readMediaReference(parsed.uri);
      const contentType = mimeTypeFromMediaPath(path);
      const range = parseByteRange(c.req.header('Range'), buffer.byteLength);
      const commonHeaders = {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
        'Content-Type': contentType,
      };
      if (range === 'invalid') {
        return new Response(null, {
          status: 416,
          headers: {
            ...commonHeaders,
            'Content-Range': `bytes */${buffer.byteLength}`,
          },
        });
      }
      if (range) {
        const body = buffer.subarray(range.start, range.end + 1);
        return new Response(body, {
          status: 206,
          headers: {
            ...commonHeaders,
            'Content-Length': String(body.byteLength),
            'Content-Range': `bytes ${range.start}-${range.end}/${buffer.byteLength}`,
          },
        });
      }
      return new Response(buffer, {
        headers: {
          ...commonHeaders,
          'Content-Length': String(buffer.byteLength),
        },
      });
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, uri: uriRaw, errorMessage: em }, `Media read failed: ${em}`);
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
  });
}
