import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { hasGatewayScope } from '../../security/gateway-scopes.js';
import { convertMeetingAction, meetingActionTasks } from '../../../discussions/action-tasks.js';
import { MeetingEditSchema } from '../../../discussions/edits.js';
import { exportDiscussion } from '../../../discussions/export.js';
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
    const transcript = service.discussions.transcript(c.req.param('id'), c.req.query('revision') === undefined ? undefined : Number(c.req.query('revision')));
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
        typeof body.speakerLabel === 'string' ? body.speakerLabel : undefined,
        body.applyToSpeakerGroup === true,
        typeof body.expectedTranscriptRevision === 'number' ? body.expectedTranscriptRevision : undefined,
      ));
    } catch (error) {
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    }
  });

  authenticated.post('/api/discussions/:id/organize', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try { return c.json(await service.discussions.reorganize(c.req.param('id'), typeof body.template === 'string' ? body.template : 'general'), 202); }
    catch (error) { const response = errorResponse(error); if (response) return c.json(response.body, response.status); throw error; }
  });

  authenticated.patch('/api/discussions/:id/summary', strictRateLimitMiddleware, async (c) => {
    const parsed = MeetingEditSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid meeting edit' }, 400);
    try { return c.json(service.discussions.editSummary(c.req.param('id'), parsed.data)); }
    catch (error) { const response = errorResponse(error); if (response) return c.json(response.body, response.status); throw error; }
  });
  authenticated.get('/api/discussions/:id/actions', async (c) => {
    if (!await service.discussions.get(c.req.param('id'))) return c.json({ error: 'Discussion not found' }, 404);
    return c.json(meetingActionTasks(c.req.param('id')));
  });
  authenticated.post('/api/discussions/:id/actions/:actionId/convert', strictRateLimitMiddleware, async (c) => {
    if (!hasGatewayScope(getGatewayPrincipal(c).scopes, 'tasks.write')) return c.json({ error: 'Task write permission required' }, 403);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try { return c.json(convertMeetingAction(c.req.param('id'), c.req.param('actionId'), Number(body.organizationRevision))); }
    catch (error) { const response = errorResponse(error); if (response) return c.json(response.body, response.status); throw error; }
  });
  authenticated.get('/api/discussions/:id/export', async (c) => {
    const detail = await service.discussions.get(c.req.param('id'));
    if (!detail) return c.json({ error: 'Discussion not found' }, 404);
    const format = c.req.query('format') ?? 'md';
    try {
      const text = exportDiscussion(detail, format);
      c.header('Content-Disposition', `attachment; filename="meeting.${format}"`);
      c.header('Cache-Control', 'no-store');
      return c.text(text);
    } catch (error) { const response = errorResponse(error); if (response) return c.json(response.body, response.status); throw error; }
  });
  authenticated.get('/api/discussions/:id/audio', async (c) => {
    const detail = await service.discussions.get(c.req.param('id'));
    if (!detail?.discussion.audioAttachmentId || detail.discussion.audioDeletedAt) return c.json({ error: 'Recording unavailable' }, 404);
    const attachment = await service.notesServiceInstance.getAttachmentPath(detail.note.id, detail.discussion.audioAttachmentId);
    if (!attachment) return c.json({ error: 'Recording unavailable' }, 404);
    const info = await stat(attachment.filePath).catch(() => null);
    if (!info) return c.json({ error: 'Recording unavailable' }, 404);
    let start = 0; let end = info.size - 1;
    const range = c.req.header('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return c.body(null, 416, { 'Content-Range': `bytes */${info.size}` });
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) return c.body(null, 416, { 'Content-Range': `bytes */${info.size}` });
      c.header('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    c.header('Content-Type', attachment.mimeType);
    c.header('Accept-Ranges', 'bytes');
    c.header('Content-Length', String(end - start + 1));
    c.header('Cache-Control', 'no-store');
    return c.body(Readable.toWeb(createReadStream(attachment.filePath, { start, end })) as ReadableStream<Uint8Array>, range ? 206 : 200);
  });

  authenticated.get('/api/discussions/:id/recording/chunks', (c) => {
    try { return c.json(service.discussions.recordingChunks(c.req.param('id'))); }
    catch (error) { const response = errorResponse(error); if (response) return c.json(response.body, response.status); throw error; }
  });

  authenticated.put('/api/discussions/:id/recording/chunks/:sequence', mediaRateLimitMiddleware, async (c) => {
    if (!c.req.raw.body) return c.json({ error: 'Missing audio body' }, 400);
    try {
      return c.json(await service.discussions.uploadRecordingChunk(c.req.param('id'), Number(c.req.param('sequence')), c.req.header('x-audio-sha256') ?? '', c.req.raw.body), 201);
    } catch (error) { const response = errorResponse(error); if (response) return c.json(response.body, response.status); throw error; }
  });

  authenticated.get('/api/discussions/:id/recording/job', (c) => {
    try {
      const job = service.discussions.recordingJob(c.req.param('id'));
      return job ? c.json(job) : c.json({ error: 'Recording job not found' }, 404);
    } catch (error) { const response = errorResponse(error); if (response) return c.json(response.body, response.status); throw error; }
  });

  authenticated.post('/api/discussions/:id/capture/seal', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      return c.json(await service.discussions.sealRecording(c.req.param('id'), {
        lastSequence: Number(body.lastSequence),
        chunkCount: Number(body.chunkCount), mimeType: typeof body.mimeType === 'string' ? body.mimeType : '', fileName: typeof body.fileName === 'string' ? body.fileName : '',
      }), 202);
    } catch (error) { const response = errorResponse(error); if (response) return c.json(response.body, response.status); throw error; }
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
