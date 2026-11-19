import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { SpacePatchSchema, SpaceSaveReplySchema, SpaceSaveVersionSchema, SpaceWorkbookActionSchema } from '@xopcai/gateway-contract';

import { createSpaceWorkbook, createSpaceWorkbookSchema, loadSpaceWorkbook, openSpaceBudgetWorkbook, saveSpaceWorkbook, saveSpaceWorkbookSchema, SPACE_WORKBOOK_MAX_BYTES, undoSpaceWorkbookVersion } from '../../../space/budget-workbook.js';
import { applyWorkbookProposal, findWorkbookProposal, workbookProposalView } from '../../../space/workbook-proposals.js';
import { changeSpaceItem, findSpaceArtifact, findSpaceTaskDelivery, getSpaceItem, isSpaceMediaMime, listSpaceItems, purgeSpaceItem, readSpaceContent, saveSpaceReply, saveSpaceVersion } from '../../../space/repository.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const revisionSchema = SpacePatchSchema.pick({ revision: true });
const listSchema = z.object({
  view: z.enum(['all', 'favorites', 'trash']).default('all'),
  q: z.string().max(160).optional(),
  kind: z.string().max(60).optional(),
  projectId: z.string().max(160).optional(),
  taskId: z.string().max(160).optional(),
  cursor: z.string().max(512).optional(),
  versionTargetFor: z.string().uuid().optional(),
});

export function registerSpaceRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const limited = deps.strictRateLimitMiddleware;
  app.get('/api/spaces/items', c => {
    const input = listSchema.safeParse(c.req.query());
    return input.success ? c.json(listSpaceItems(input.data)) : c.json({ error: 'Invalid search' }, 400);
  });
  app.post('/api/spaces/items', limited, async c => {
    const input = SpaceSaveReplySchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Invalid reply reference' }, 400);
    const id = saveSpaceReply(input.data.conversationId, input.data.entryId ?? { turnId: input.data.turnId! });
    return id ? c.json({ id }) : c.json({ error: 'Reply not found' }, 404);
  });
  app.get('/api/spaces/artifacts/:mediaId', c => {
    const result = findSpaceArtifact(c.req.param('mediaId'));
    return result ? c.json(result) : c.json({ error: 'Artifact not found' }, 404);
  });
  app.get('/api/spaces/deliveries/:deliveryId', c => {
    const result = findSpaceTaskDelivery(c.req.param('deliveryId'));
    return result ? c.json(result) : c.json({ error: 'Delivery not found' }, 404);
  });
  app.get('/api/spaces/items/:id', c => {
    const item = getSpaceItem(c.req.param('id'));
    return item ? c.json(item) : c.json({ error: 'Item not found' }, 404);
  });
  app.post('/api/spaces/items/budget-demo', limited, c => {
    const result = openSpaceBudgetWorkbook();
    return result === 'trashed' ? c.json({ error: result }, 409) : c.json(result);
  });
  app.post('/api/spaces/items/workbooks', limited, bodyLimit({ maxSize: SPACE_WORKBOOK_MAX_BYTES }), async c => {
    const input = createSpaceWorkbookSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Invalid workbook snapshot' }, 400);
    const result = createSpaceWorkbook(input.data);
    return result === 'conflict' ? c.json({ error: result }, 409) : c.json(result, 201);
  });
  app.post('/api/spaces/items/:id/workbook', limited, bodyLimit({ maxSize: SPACE_WORKBOOK_MAX_BYTES }), async c => {
    const input = saveSpaceWorkbookSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Invalid workbook snapshot' }, 400);
    const result = saveSpaceWorkbook(c.req.param('id'), input.data);
    return typeof result !== 'string' ? c.json(result) : c.json({ error: result }, result === 'missing' ? 404 : 409);
  });
  app.get('/api/spaces/items/:id/workbook-actions', c => {
    const input = z.uuid().safeParse(c.req.query('proposal'));
    const proposal = input.success ? findWorkbookProposal(input.data) : undefined;
    if (!proposal || proposal.id !== c.req.param('id') || !loadSpaceWorkbook(proposal.id)) return c.json({ error: 'Proposal is unavailable' }, 404);
    return c.json(workbookProposalView(proposal));
  });
  app.post('/api/spaces/items/:id/workbook-actions', limited, async c => {
    const input = SpaceWorkbookActionSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Invalid workbook action' }, 400);
    const id = c.req.param('id');
    if (input.data.action === 'undo') {
      const result = undoSpaceWorkbookVersion(id, input.data.versionId, input.data.sourceVersionId);
      return typeof result === 'string' ? c.json({ error: result }, 409) : c.json(result);
    }
    const proposal = findWorkbookProposal(input.data.proposalId);
    if (!proposal || proposal.id !== id) return c.json({ error: 'Proposal is unavailable' }, 404);
    const result = await applyWorkbookProposal(proposal, { allowReviewedChanges: true, assertWritable: () => {} });
    return typeof result !== 'string' ? c.json(result) : c.json({ error: result }, result === 'missing' ? 404 : 409);
  });
  app.patch('/api/spaces/items/:id', limited, async c => {
    const input = SpacePatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Invalid item update' }, 400);
    const { revision, ...patch } = input.data;
    const result = changeSpaceItem(c.req.param('id'), revision, patch);
    return result === 'ok' ? c.json(getSpaceItem(c.req.param('id'))) : c.json({ error: result }, result === 'missing' ? 404 : 409);
  });
  app.post('/api/spaces/items/:id/versions', limited, async c => {
    const input = SpaceSaveVersionSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Invalid version reference' }, 400);
    const result = saveSpaceVersion(c.req.param('id'), input.data.sourceVersionId, input.data.revision);
    return typeof result !== 'string' ? c.json(result)
      : c.json({ error: result }, result === 'missing' ? 404 : 409);
  });
  for (const action of ['trash', 'restore', 'purge'] as const) {
    const handler = async (c: Context) => {
      const input = revisionSchema.safeParse(await c.req.json().catch(() => null));
      if (!input.success) return c.json({ error: 'Invalid item revision' }, 400);
      const id = c.req.param('id')!;
      const result = action === 'purge' ? purgeSpaceItem(id, input.data.revision)
        : changeSpaceItem(id, input.data.revision, { trash: action === 'trash' });
      return result === 'ok' ? c.json({ ok: true }) : c.json({ error: result }, result === 'missing' ? 404 : 409);
    };
    if (action === 'trash') app.delete('/api/spaces/items/:id', limited, handler);
    else app.post(`/api/spaces/items/:id/${action}`, limited, handler);
  }
  app.get('/api/spaces/items/:id/versions/:versionId/content', async c => {
    const content = await readSpaceContent(c.req.param('id'), c.req.param('versionId'), c.req.header('Range'),
      { mediaOnly: Boolean(c.req.query('playbackTicket')), headOnly: c.req.method === 'HEAD' });
    if (!content) return c.json({ error: 'Content not found' }, 404);
    const { version, body, size, range } = content;
    const headers = new Headers({
      'Content-Type': /^[\w.+-]+\/[\w.+-]+$/.test(version.mimeType) ? version.mimeType : 'application/octet-stream',
      'Content-Disposition': `${isSpaceMediaMime(version.mimeType) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(Buffer.from(version.fileName, 'utf8').toString('utf8')).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())}`,
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes',
    });
    if (range === 'invalid') {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      headers.set('Content-Length', String(range.end - range.start + 1));
      return new Response(body, { status: 206, headers });
    }
    headers.set('Content-Length', String(size));
    return new Response(body, { headers });
  });
}
