import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../../service.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerDiscussionRoutes } from '../discussions.js';

function createApp(overrides: Partial<GatewayService['discussions']> = {}) {
  const discussions = {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(() => ({ items: [], total: 0, limit: 30, offset: 0, hasMore: false })),
    metrics: vi.fn(() => ({ total: 0, byStatus: {}, averageTimeToReviewMs: null, averageTimeToCompleteMs: null })),
    uploadAudio: vi.fn(),
    deleteAudio: vi.fn(),
    saveReview: vi.fn(),
    complete: vi.fn(),
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

  it('normalizes a create request at the HTTP boundary', async () => {
    const detail = { discussion: { id: 'discussion-1' }, note: { id: 'note-1' } };
    const { app, discussions } = createApp({ create: vi.fn().mockResolvedValue(detail) });
    const response = await app.request('/api/discussions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: 'draft-1',
        projectId: ' project-1 ',
        title: 'Weekly review',
        captureMode: 'solo',
        source: 'electron',
      }),
    });

    expect(response.status).toBe(201);
    expect(discussions.create).toHaveBeenCalledWith({
      clientRequestId: 'draft-1',
      projectId: 'project-1',
      title: 'Weekly review',
      captureMode: 'solo',
      consentConfirmed: false,
      source: 'electron',
    });
  });

  it('passes optimistic review revisions and selected actions to the service', async () => {
    const detail = { discussion: { id: 'discussion-1' }, note: { id: 'note-1' } };
    const { app, discussions } = createApp({
      saveReview: vi.fn().mockResolvedValue(detail),
      complete: vi.fn().mockResolvedValue({ ...detail, createdWorkItemIds: ['work-1'] }),
    });
    const review = await app.request('/api/discussions/discussion-1/review', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 2, analysis: { summary: 'Reviewed' } }),
    });
    const complete = await app.request('/api/discussions/discussion-1/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 3, actionItemIds: ['action-1'] }),
    });

    expect(review.status).toBe(200);
    expect(discussions.saveReview).toHaveBeenCalledWith('discussion-1', { summary: 'Reviewed' }, 2);
    expect(complete.status).toBe(200);
    expect(discussions.complete).toHaveBeenCalledWith('discussion-1', 3, ['action-1']);
  });

  it('exposes metrics and deletes processed audio through explicit endpoints', async () => {
    const detail = { discussion: { id: 'discussion-1' }, note: { id: 'note-1' } };
    const { app, discussions } = createApp({ deleteAudio: vi.fn().mockResolvedValue(detail) });

    const metrics = await app.request('/api/discussions/metrics');
    const deleted = await app.request('/api/discussions/discussion-1/audio', { method: 'DELETE' });

    expect(metrics.status).toBe(200);
    expect(discussions.metrics).toHaveBeenCalledOnce();
    expect(deleted.status).toBe(200);
    expect(discussions.deleteAudio).toHaveBeenCalledWith('discussion-1');
  });
});
