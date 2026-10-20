import type { Hono } from 'hono';
import { conversationIdSchema } from '@xopcai/gateway-contract';

import { listConversationLaunches } from '../../../storage/sqlite/conversation-launch-repository.js';
import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerConversationLaunchRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get('/api/sessions/:key/launched-conversations', c => {
    c.header('Cache-Control', 'no-store');
    if (!deps.service.isGatewayReady()) return c.json({ error: 'Gateway is starting' }, 503);
    const id = conversationIdSchema.safeParse(c.req.param('key'));
    const ids = [...new Set((c.req.query('ids') ?? '').split(',').filter(Boolean))];
    if (!id.success || !ids.length || ids.length > 50 || ids.some(value => !conversationIdSchema.safeParse(value).success)) {
      return c.json({ error: 'Invalid conversation identities' }, 400);
    }
    if (!getSessionMetadata(id.data)) return c.json({ error: 'Conversation not found' }, 404);
    return c.json({ items: listConversationLaunches(id.data, ids) });
  });
  app.get('/api/sessions/:key/launch-origin', c => {
    c.header('Cache-Control', 'no-store');
    if (!deps.service.isGatewayReady()) return c.json({ error: 'Gateway is starting' }, 503);
    const id = conversationIdSchema.safeParse(c.req.param('key'));
    const launchId = conversationIdSchema.safeParse(c.req.query('launchId'));
    if (!id.success || !launchId.success) return c.json({ error: 'Invalid launch identity' }, 400);
    if (!getSessionMetadata(id.data)) return c.json({ error: 'Conversation not found' }, 404);
    const row = getSqliteDatabase().prepare(`SELECT source_conversation_id AS conversationId FROM conversation_launches
      WHERE id=? AND target_conversation_id=?`).get(launchId.data, id.data) as { conversationId: string } | undefined;
    if (!row) return c.json({ error: 'Launch not found' }, 404);
    const source = getSessionMetadata(row.conversationId);
    return c.json({ conversationId: row.conversationId, available: Boolean(source), title: source?.name });
  });
}
