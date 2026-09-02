import { readFile, writeFile } from 'node:fs/promises';

import type { Hono } from 'hono';

import { createGatewayRouteLogger } from '../lib/route-logger.js';
import { resolveHeartbeatMdPath } from '../../workspace-heartbeat-path.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('Workspace');

export function registerWorkspaceRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  authenticated.get('/api/workspace/heartbeat-md', async (c) => {
    const path = resolveHeartbeatMdPath(service.currentConfig);
    if (!path) return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    try {
      return c.json({ ok: true, payload: { content: await readFile(path, 'utf8'), file: 'HEARTBEAT.md' } });
    } catch {
      return c.json({ ok: true, payload: { content: '', file: 'HEARTBEAT.md' } });
    }
  });

  authenticated.put('/api/workspace/heartbeat-md', async (c) => {
    const path = resolveHeartbeatMdPath(service.currentConfig);
    if (!path) return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    const body = await c.req.json<{ content?: unknown }>().catch(() => null);
    if (!body || typeof body.content !== 'string') {
      return c.json({ ok: false, error: { message: 'content is required' } }, 400);
    }
    try {
      await writeFile(path, body.content, 'utf8');
      return c.json({ ok: true, payload: { file: 'HEARTBEAT.md' } });
    } catch (error) {
      log.error({ err: error, path }, 'Failed to write HEARTBEAT.md');
      return c.json({ ok: false, error: { message: 'Write failed' } }, 500);
    }
  });
}
