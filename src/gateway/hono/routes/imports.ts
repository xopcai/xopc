import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { createRuntimeImportService } from '../../../imports/runtime.js';
import { importProduct, listImportSources } from '../../../imports/productImport.js';
import { isImportSource } from '../../../imports/sources.js';
import { ImportError } from '../../../imports/types.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const requestSchema = z.object({ requestId: z.string().uuid() }).strict();
export function registerImportRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const respond = async (c: Context, run: () => unknown | Promise<unknown>) => {
    try {
      if (getGatewayPrincipal(c).kind !== 'owner') throw new ImportError('owner_required', 'Only the Gateway owner can import local capabilities', 403);
      return c.json({ ok: true, data: await run() });
    } catch (error) {
      if (error instanceof z.ZodError) return c.json({ ok: false, code: 'invalid_input', error: 'Invalid import request' }, 400);
      if (error instanceof ImportError) return c.json({ ok: false, code: error.code, error: error.message }, error.status);
      return c.json({ ok: false, code: 'import_failed', error: 'Import could not finish. Try again; existing content is preserved.' }, 400);
    }
  };
  app.get('/api/imports/sources', c => respond(c, () => ({ sources: listImportSources('gateway-owner') })));
  app.post('/api/imports/sources/:source/import', deps.strictRateLimitMiddleware, c => respond(c, async () => {
    const source = c.req.param('source');
    if (!isImportSource(source)) throw new ImportError('unsupported_source', 'Unsupported source');
    const { requestId } = requestSchema.parse(await c.req.json());
    const service = createRuntimeImportService('gateway-owner',
      () => deps.service.agentService.refreshSkillsAfterDiskChange(),
      root => deps.service.agentService.getWorkspaceTrust(root).trusted);
    return importProduct(service, source, requestId);
  }));
}
