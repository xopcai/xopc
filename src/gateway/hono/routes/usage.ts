import { Hono } from 'hono';
import { z } from 'zod';

import {
  getAiUsageEventView,
  listAiUsageEvents,
  listAiUsageTrace,
  summarizeAiUsage,
  type AiUsageQuery,
} from '../../../storage/sqlite/ai-usage-repository.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1_000;
const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1_000;

const filtersSchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().positive().optional(),
  category: z.string().trim().min(1).max(80).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(240).optional(),
  agentId: z.string().trim().min(1).max(200).optional(),
  conversationId: z.string().trim().min(1).max(200).optional(),
});

function parseFilters(value: Record<string, string>): AiUsageQuery {
  const parsed = filtersSchema.parse(value);
  const to = parsed.to ?? Date.now() + 1;
  const from = parsed.from ?? to - DEFAULT_RANGE_MS;
  if (from >= to || to - from > MAX_RANGE_MS) throw new Error('invalid_usage_range');
  return { ...parsed, from, to };
}

function parseCursor(value: string | undefined): { startedAt: number; id: string } | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(':');
  const startedAt = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (separator < 1 || !Number.isSafeInteger(startedAt) || startedAt < 0 || !id) {
    throw new Error('invalid_usage_cursor');
  }
  return { startedAt, id };
}

export function registerUsageRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError || error.message.startsWith('invalid_usage_')) {
      return c.json({ error: 'invalid_usage_query' }, 400);
    }
    throw error;
  });
  app.get('/summary', c => c.json(summarizeAiUsage(parseFilters(c.req.query()))));
  app.get('/events', c => {
    const limit = z.coerce.number().int().min(1).max(200).optional().parse(c.req.query('limit'));
    return c.json(listAiUsageEvents({
      ...parseFilters(c.req.query()),
      limit,
      before: parseCursor(c.req.query('cursor')),
    }));
  });
  app.get('/events/:id', c => {
    const event = getAiUsageEventView(c.req.param('id'));
    return event ? c.json({ event }) : c.json({ error: 'usage_event_not_found' }, 404);
  });
  app.get('/traces/:traceId', c => c.json({ events: listAiUsageTrace(c.req.param('traceId')) }));
  authenticated.route('/api/usage', app);
}
