import type { Context, Hono } from 'hono';

import { DISCUSSION_STATUSES, DiscussionServiceError } from '../../../discussions/index.js';
import type { DiscussionStatus } from '../../../discussions/index.js';

import type { AuthenticatedRouteDeps } from './deps.js';

function errorResponse(error: unknown): { body: { error: string; code?: string }; status: 400 | 404 | 409 } | null {
  if (!(error instanceof DiscussionServiceError)) return null;
  const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400;
  return { body: { error: error.message, code: error.code }, status };
}

async function multipart(c: Context): Promise<Record<string, unknown> | null> {
  try {
    return await c.req.parseBody({ all: true }) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function registerDiscussionRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;
  const mediaRateLimitMiddleware = deps.mediaRateLimitMiddleware
    ?? deps.chatRateLimitMiddleware
    ?? strictRateLimitMiddleware;

  authenticated.get('/api/discussion-capture/settings', (c) => c.json(service.discussions.settings()));

  authenticated.put('/api/discussion-capture/settings', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (!Number.isInteger(body.consentPolicyVersion)) {
      return c.json({ error: 'consentPolicyVersion must be an integer' }, 400);
    }
    try {
      return c.json(service.discussions.acknowledgeConsent(Number(body.consentPolicyVersion)));
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.post('/api/discussions', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const detail = await service.discussions.create({
        clientRequestId: typeof body.clientRequestId === 'string' ? body.clientRequestId : '',
        ...(typeof body.contextProjectId === 'string' && body.contextProjectId.trim()
          ? { contextProjectId: body.contextProjectId.trim() }
          : {}),
        consentPolicyVersion: Number(body.consentPolicyVersion),
        source: body.source === 'electron' ? 'electron' : 'web',
      });
      return c.json(detail, 201);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.get('/api/discussions', (c) => {
    const statusRaw = c.req.query('status');
    if (statusRaw && statusRaw !== 'active' && !DISCUSSION_STATUSES.includes(statusRaw as DiscussionStatus)) {
      return c.json({ error: 'Invalid discussion status' }, 400);
    }
    const status: DiscussionStatus | 'active' | undefined = statusRaw === 'active'
      ? 'active'
      : DISCUSSION_STATUSES.includes(statusRaw as DiscussionStatus)
        ? statusRaw as DiscussionStatus
        : undefined;
    const limit = Number.parseInt(c.req.query('limit') ?? '', 10);
    const offset = Number.parseInt(c.req.query('offset') ?? '', 10);
    return c.json(service.discussions.list({
      status,
      projectId: c.req.query('projectId')?.trim() || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    }));
  });

  authenticated.get('/api/discussions/metrics', (c) => c.json(service.discussions.metrics()));

  authenticated.get('/api/discussions/by-note/:noteId', async (c) => {
    const detail = await service.discussions.getByNoteId(c.req.param('noteId'));
    return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
  });

  authenticated.get('/api/discussions/:id', async (c) => {
    const detail = await service.discussions.get(c.req.param('id'));
    return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
  });

  authenticated.get('/api/discussions/:id/transcript', (c) => {
    const transcript = service.discussions.transcript(c.req.param('id'));
    return transcript ? c.json(transcript) : c.json({ error: 'Discussion not found' }, 404);
  });

  authenticated.put('/api/discussions/:id/segments/:sequence', mediaRateLimitMiddleware, async (c) => {
    const body = await multipart(c);
    if (!body) return c.json({ error: 'Invalid multipart body' }, 400);
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'Missing file field' }, 400);
    const sequence = Number.parseInt(c.req.param('sequence'), 10);
    const startedAtMs = Number(body.startedAtMs);
    const endedAtMs = Number(body.endedAtMs);
    const sha256 = typeof body.sha256 === 'string' ? body.sha256 : '';
    try {
      return c.json(service.discussions.uploadSegment({
        discussionId: c.req.param('id'),
        sequence,
        file: { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type },
        startedAtMs,
        endedAtMs,
        sha256,
      }), 201);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.patch('/api/discussions/:id/segments/:sequence', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      return c.json(service.discussions.correctSegment(
        c.req.param('id'),
        Number.parseInt(c.req.param('sequence'), 10),
        typeof body.displayText === 'string' ? body.displayText : '',
        Number(body.expectedRevision),
      ));
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.put('/api/discussions/:id/recording', strictRateLimitMiddleware, async (c) => {
    const body = await multipart(c);
    if (!body) return c.json({ error: 'Invalid multipart body' }, 400);
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'Missing file field' }, 400);
    try {
      const detail = await service.discussions.uploadRecording(c.req.param('id'), {
        name: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type,
      }, Number(body.durationMs));
      return detail ? c.json(detail, 201) : c.json({ error: 'Discussion not found' }, 404);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.post('/api/discussions/:id/stop', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const detail = await service.discussions.stop(
        c.req.param('id'),
        Number(body.lastSequence),
        Number(body.durationMs),
      );
      return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.post('/api/discussions/:id/retry', strictRateLimitMiddleware, async (c) => {
    try {
      const detail = await service.discussions.retry(c.req.param('id'));
      return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.post('/api/discussions/:id/cancel', strictRateLimitMiddleware, async (c) => {
    try {
      const detail = await service.discussions.cancel(c.req.param('id'));
      return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.delete('/api/discussions/:id/audio', strictRateLimitMiddleware, async (c) => {
    try {
      const detail = await service.discussions.deleteAudio(c.req.param('id'));
      return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.delete('/api/discussions/:id/project', strictRateLimitMiddleware, async (c) => {
    try {
      const detail = await service.discussions.unlinkInferredProject(c.req.param('id'));
      return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });
}
