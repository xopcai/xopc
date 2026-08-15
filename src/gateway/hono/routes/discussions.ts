import type { Hono } from 'hono';

import { DISCUSSION_STATUSES, DiscussionServiceError } from '../../../discussions/index.js';
import type { DiscussionStatus } from '../../../discussions/index.js';

import type { AuthenticatedRouteDeps } from './deps.js';

function errorResponse(error: unknown): { body: { error: string; code?: string }; status: 400 | 404 | 409 } | null {
  if (!(error instanceof DiscussionServiceError)) return null;
  const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400;
  return { body: { error: error.message, code: error.code }, status };
}

export function registerDiscussionRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.post('/api/discussions', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId : '';
    const captureMode = body.captureMode === 'solo' ? 'solo' : 'conversation';
    const source = body.source === 'electron' ? 'electron' : 'web';
    try {
      const detail = await service.discussions.create({
        clientRequestId,
        ...(typeof body.projectId === 'string' && body.projectId.trim() ? { projectId: body.projectId.trim() } : {}),
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(typeof body.language === 'string' ? { language: body.language } : {}),
        captureMode,
        consentConfirmed: body.consentConfirmed === true,
        source,
      });
      return c.json(detail, 201);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.get('/api/discussions', async (c) => {
    const statusRaw = c.req.query('status');
    if (statusRaw && statusRaw !== 'active' && !DISCUSSION_STATUSES.includes(statusRaw as DiscussionStatus)) {
      return c.json({ error: 'Invalid discussion status' }, 400);
    }
    const status: DiscussionStatus | 'active' | undefined = statusRaw === 'active'
      ? 'active'
      : DISCUSSION_STATUSES.includes(statusRaw as DiscussionStatus)
        ? statusRaw as DiscussionStatus
        : undefined;
    const projectId = c.req.query('projectId')?.trim() || undefined;
    const limitRaw = Number.parseInt(c.req.query('limit') ?? '', 10);
    const offsetRaw = Number.parseInt(c.req.query('offset') ?? '', 10);
    return c.json(service.discussions.list({
      status,
      projectId,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : undefined,
    }));
  });

  authenticated.get('/api/discussions/metrics', (c) => c.json(service.discussions.metrics()));

  authenticated.get('/api/discussions/:id', async (c) => {
    try {
      const detail = await service.discussions.get(c.req.param('id'));
      return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.post('/api/discussions/:id/audio', strictRateLimitMiddleware, async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody({ all: true });
    } catch {
      return c.json({ error: 'Invalid multipart body' }, 400);
    }
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'Missing file field' }, 400);
    const durationMs = Number.parseInt(typeof body.durationMs === 'string' ? body.durationMs : '', 10);
    if (!Number.isFinite(durationMs)) return c.json({ error: 'Missing durationMs field' }, 400);
    try {
      const detail = await service.discussions.uploadAudio(c.req.param('id'), {
        name: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type,
      }, durationMs);
      return detail ? c.json(detail, 201) : c.json({ error: 'Discussion not found' }, 404);
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

  authenticated.put('/api/discussions/:id/review', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
      return c.json({ error: 'expectedRevision must be a non-negative integer' }, 400);
    }
    try {
      const detail = await service.discussions.saveReview(
        c.req.param('id'),
        body.analysis,
        Number(body.expectedRevision),
      );
      return detail ? c.json(detail) : c.json({ error: 'Discussion not found' }, 404);
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.post('/api/discussions/:id/complete', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
      return c.json({ error: 'expectedRevision must be a non-negative integer' }, 400);
    }
    const actionItemIds = Array.isArray(body.actionItemIds)
      ? body.actionItemIds.filter((value): value is string => typeof value === 'string')
      : [];
    try {
      const result = await service.discussions.complete(
        c.req.param('id'),
        Number(body.expectedRevision),
        actionItemIds,
      );
      return result ? c.json(result) : c.json({ error: 'Discussion not found' }, 404);
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
}
