import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerSessionsRoutes } from '../sessions.js';

describe('session compact history opt-in', () => {
  it('loads public execution detail on demand for one turn', async () => {
    const getExecutionDetail = vi.fn().mockResolvedValue({ turnId: 'turn-1', steps: [{ id: 'step-1', kind: 'thinking' }] });
    const app = new Hono();
    registerSessionsRoutes(app, { service: { isGatewayReady: () => true, sessions: { getExecutionDetail } } } as never);
    const response = await app.request('/api/sessions/c/execution-detail?turnId=turn-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getExecutionDetail).toHaveBeenCalledWith('c', 'turn-1');
    expect((await app.request('/api/sessions/c/execution-detail')).status).toBe(400);
  });
  it('keeps default mode and varies cache validators by view and page', async () => {
    const getMessagePage = vi.fn().mockResolvedValue({ session: { transcriptId: 't', messages: [] }, pagination: { revision: 30 } });
    const app = new Hono();
    registerSessionsRoutes(app, { service: { isGatewayReady: () => true, sessions: { getMessagePage } } } as never);
    const full = await app.request('/api/sessions/c/history');
    expect(full.status).toBe(200);
    expect(getMessagePage).toHaveBeenLastCalledWith('c', expect.objectContaining({ compact: false }));
    const compact = await app.request('/api/sessions/c/history?view=compact&limit=20', { headers: { 'If-None-Match': full.headers.get('etag')! } });
    expect(compact.status).toBe(200);
    expect(getMessagePage).toHaveBeenLastCalledWith('c', expect.objectContaining({ compact: true, limit: 20 }));
    const older = await app.request('/api/sessions/c/history?view=compact&limit=20&before=12', { headers: { 'If-None-Match': compact.headers.get('etag')! } });
    expect(older.status).toBe(200);
    expect(getMessagePage).toHaveBeenLastCalledWith('c', expect.objectContaining({ compact: true, before: '12' }));
    const unchanged = await app.request('/api/sessions/c/history?view=compact&limit=20', { headers: { 'If-None-Match': compact.headers.get('etag')! } });
    expect(unchanged.status).toBe(304);
  });

  it('invalidates history cache when message presentation changes without a new transcript row', async () => {
    const getMessagePage = vi.fn()
      .mockResolvedValueOnce({ session: { transcriptId: 't', messages: [{ role: 'assistant', content: 'Done' }] }, pagination: { revision: 30 } })
      .mockResolvedValueOnce({ session: { transcriptId: 't', messages: [{ role: 'assistant', content: 'Done', startsNewBubble: true }] }, pagination: { revision: 30 } });
    const app = new Hono();
    registerSessionsRoutes(app, { service: { isGatewayReady: () => true, sessions: { getMessagePage } } } as never);
    const first = await app.request('/api/sessions/c/history');
    const updated = await app.request('/api/sessions/c/history', { headers: { 'If-None-Match': first.headers.get('etag')! } });
    expect(updated.status).toBe(200);
    expect(updated.headers.get('etag')).not.toBe(first.headers.get('etag'));
  });
});
