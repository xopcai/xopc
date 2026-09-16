import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { createRuntimeImportService } from '../../../imports/runtime.js';
import { importSelection, listImportSources } from '../../../imports/productImport.js';
import { scanProduct, previewInventoryItem, getLiveInventory, publicInventory } from '../../../imports/inventory.js';
import { ImportSelectionRepository } from '../../../storage/sqlite/import-selection-repository.js';
import { isImportSource } from '../../../imports/sources.js';
import { ImportError } from '../../../imports/types.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const selectionSchema = z.object({ inventoryId: z.string().uuid(), candidateIds: z.array(z.string().uuid()).min(1).max(5000), requestId: z.string().uuid(), retryOf: z.string().uuid().optional() }).strict();
export function registerImportRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const service = () => createRuntimeImportService('gateway-owner', () => deps.service.agentService.refreshSkillsAfterDiskChange(),
    root => deps.service.agentService.getWorkspaceTrust(root).trusted);
  const respond = async (c: Context, run: () => unknown | Promise<unknown>) => {
    try {
      if (getGatewayPrincipal(c).kind !== 'owner') throw new ImportError('owner_required', 'Only the Gateway owner can import local capabilities', 403);
      return c.json({ ok: true, data: await run() });
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ ok: false, code: 'invalid_input', error: 'Invalid import request' }, 400);
      if (error instanceof ImportError) return c.json({ ok: false, code: error.code, error: error.message }, error.status);
      return c.json({ ok: false, code: 'import_failed', error: 'Import could not finish. Existing content is preserved.' }, 400);
    }
  };
  app.get('/api/imports/sources', c => respond(c, () => ({ sources: listImportSources('gateway-owner') })));
  app.post('/api/imports/sources/:source/scan', deps.strictRateLimitMiddleware, c => respond(c, async () => {
    const source = c.req.param('source');
    if (!isImportSource(source)) throw new ImportError('unsupported_source', 'Unsupported source');
    z.object({}).strict().parse(await c.req.json());
    return scanProduct(service(), source);
  }));
  app.get('/api/imports/inventories/:id', c => respond(c, () => publicInventory(getLiveInventory('gateway-owner', c.req.param('id')))));
  app.get('/api/imports/inventories/:id/items/:itemId/preview', c => respond(c, () => previewInventoryItem(service(), 'gateway-owner', c.req.param('id'), c.req.param('itemId'))));
  app.post('/api/imports/runs', deps.strictRateLimitMiddleware, c => respond(c, async () => importSelection(service(), selectionSchema.parse(await c.req.json()))));
  app.get('/api/imports/runs/:id', c => respond(c, () => new ImportSelectionRepository('gateway-owner').get('run', c.req.param('id'))));
}
