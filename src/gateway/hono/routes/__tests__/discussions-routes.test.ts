import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../../service.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerDiscussionRoutes } from '../discussions.js';

function createApp(overrides: Partial<GatewayService['discussions']> = {}) {
  const discussions = {
    settings: vi.fn(() => ({ consentPolicyVersion: 1 })),
    acknowledgeConsent: vi.fn(() => ({ consentPolicyVersion: 1, consentAcknowledgedAt: 1 })),
    create: vi.fn(),
    get: vi.fn(),
    getByNoteId: vi.fn(),
    transcript: vi.fn(),
    list: vi.fn(() => ({ items: [], total: 0, limit: 30, offset: 0, hasMore: false })),
    metrics: vi.fn(() => ({
      total: 0,
      byStatus: {},
      averageTimeToFirstTranscriptMs: null,
      averageTimeToCompleteMs: null,
    })),
    uploadSegment: vi.fn(),
    uploadRecording: vi.fn(),
    finish: vi.fn(),
    deleteAudio: vi.fn(),
    unlinkInferredProject: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
  const app = new Hono();
  registerDiscussionRoutes(app, {
    service: { discussions } as unknown as GatewayService,
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as AuthenticatedRouteDeps);
  return { app, discussions };
}

describe('discussion routes', () => {
  it('rejects an unknown status instead of broadening the query', async () => {
    const { app, discussions } = createApp();
    const response = await app.request('/api/discussions?status=unknown');
    expect(response.status).toBe(400);
    expect(discussions.list).not.toHaveBeenCalled();
  });

  it('acknowledges the current policy and normalizes a context-only create request', async () => {
    const detail = { discussion: { id: 'discussion-1' }, note: { id: 'note-1' } };
    const { app, discussions } = createApp({ create: vi.fn().mockResolvedValue(detail) });
    const settings = await app.request('/api/discussion-capture/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consentPolicyVersion: 1 }),
    });
    const response = await app.request('/api/discussions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: 'draft-1',
        contextProjectId: ' project-1 ',
        consentPolicyVersion: 1,
        source: 'electron',
      }),
    });

    expect(settings.status).toBe(200);
    expect(discussions.acknowledgeConsent).toHaveBeenCalledWith(1);
    expect(response.status).toBe(201);
    expect(discussions.create).toHaveBeenCalledWith({
      clientRequestId: 'draft-1',
      contextProjectId: 'project-1',
      consentPolicyVersion: 1,
      source: 'electron',
    });
  });

  it('accepts a checksum-addressed WAV segment and exposes the live transcript', async () => {
    const audio = Buffer.from('wav-audio');
    const sha256 = createHash('sha256').update(audio).digest('hex');
    const transcript = { discussionId: 'discussion-1', segments: [], text: '' };
    const { app, discussions } = createApp({
      uploadSegment: vi.fn(() => transcript),
      transcript: vi.fn(() => transcript),
    });
    const form = new FormData();
    form.set('file', new File([audio], 'segment.wav', { type: 'audio/wav' }));
    form.set('startedAtMs', '0');
    form.set('endedAtMs', '20000');
    form.set('sha256', sha256);
    const uploaded = await app.request('/api/discussions/discussion-1/segments/0', {
      method: 'PUT',
      body: form,
    });
    const read = await app.request('/api/discussions/discussion-1/transcript');

    expect(uploaded.status).toBe(201);
    expect(discussions.uploadSegment).toHaveBeenCalledWith(expect.objectContaining({
      discussionId: 'discussion-1',
      sequence: 0,
      startedAtMs: 0,
      endedAtMs: 20_000,
      sha256,
    }));
    expect(read.status).toBe(200);
  });

  it('finishes through a sequence fence and removes only explicit audio', async () => {
    const detail = { discussion: { id: 'discussion-1' }, note: { id: 'note-1' } };
    const { app, discussions } = createApp({
      finish: vi.fn().mockResolvedValue(detail),
      deleteAudio: vi.fn().mockResolvedValue(detail),
    });
    const finished = await app.request('/api/discussions/discussion-1/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastSequence: 4, durationMs: 90_000 }),
    });
    const deleted = await app.request('/api/discussions/discussion-1/audio', { method: 'DELETE' });

    expect(finished.status).toBe(200);
    expect(discussions.finish).toHaveBeenCalledWith('discussion-1', 4, 90_000);
    expect(deleted.status).toBe(200);
    expect(discussions.deleteAudio).toHaveBeenCalledWith('discussion-1');
  });
});
