import type { Hono } from 'hono';

import { ActivityService } from '../../../activity/index.js';
import type { ActivityObjectKind, ActivityVisibility } from '../../../activity/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const ACTIVITY_OBJECT_KINDS = new Set<ActivityObjectKind>([
  'project',
  'note',
  'session',
  'task',
  'workflow_run',
  'automation',
]);

function parseActivityVisibility(raw: string | undefined): ActivityVisibility | undefined {
  return raw === 'timeline' || raw === 'audit' || raw === 'debug' ? raw : undefined;
}

function parseActivityLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : undefined;
}

function parseActivityOffset(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : undefined;
}

export function parseActivityQuery(c: {
  req: { query(name: string): string | undefined };
}): {
  visibility?: ActivityVisibility;
  limit?: number;
  offset?: number;
} {
  return {
    visibility: parseActivityVisibility(c.req.query('visibility')),
    limit: parseActivityLimit(c.req.query('limit')),
    offset: parseActivityOffset(c.req.query('offset')),
  };
}

export function parseActivityIncludeRelated(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1';
}

export function registerActivityRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {
  const activity = new ActivityService();

  authenticated.get('/api/activity', (c) => {
    const result = activity.list(parseActivityQuery(c));
    return c.json({ ok: true, ...result });
  });

  authenticated.get('/api/activity/objects/:kind/:id', (c) => {
    const kind = c.req.param('kind') as ActivityObjectKind;
    if (!ACTIVITY_OBJECT_KINDS.has(kind)) {
      return c.json({ ok: false, error: 'Unsupported activity object kind' }, 400);
    }
    const id = c.req.param('id').trim();
    if (!id) return c.json({ ok: false, error: 'Missing activity object id' }, 400);
    const result = activity.listForObject({
      object: { kind, id },
      ...parseActivityQuery(c),
    });
    return c.json({ ok: true, ...result });
  });
}
