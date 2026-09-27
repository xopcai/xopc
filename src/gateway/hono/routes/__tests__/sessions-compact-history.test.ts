import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerSessionsRoutes } from '../sessions.js';

describe('session compact history opt-in', () => {
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
});
