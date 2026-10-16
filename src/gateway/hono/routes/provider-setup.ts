import { isDeepStrictEqual } from 'node:util';

import type { Hono } from 'hono';
import { z } from 'zod';

import { loadProviderSetupSnapshot } from '../../provider-model-setup.js';
import { updateGlobalDefaults, prepareUpdateGlobalDefaults, listGlobalDefaults } from '../../global-defaults-admin.js';
import { applyProviderSetup, previewProviderSetup, SetupConflictError } from '../../../providers/setup/engine.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { applySetupVoice } from '../../../providers/setup/voice.js';
import { withGatewayConfigWriteLock } from '../lib/config-write-lock.js';

const use = z.enum(['chat', 'vision', 'image', 'background', 'speech', 'transcription', 'conversation']);
const requestSchema = z.object({
  mode: z.enum(['fill', 'replace']).optional(),
  selected: z.array(use).max(7).optional(),
  overrides: z.partialRecord(use, z.string().min(1).max(512)).optional(),
  modelIds: z.array(z.string().min(1).max(512)).max(500).optional(),
}).strict();
const applySchema = requestSchema.extend({ revision: z.string().regex(/^[a-f0-9]{64}$/) });

export function registerProviderSetupRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get('/api/models/setup/:providerId', async c => {
    try {
      return c.json({ ok: true, payload: previewProviderSetup(await loadProviderSetupSnapshot(c.req.param('providerId'), deps.service.currentConfig)) });
    } catch (error) { return c.json({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } }, 400); }
  });
  app.post('/api/models/setup/:providerId/preview', deps.strictRateLimitMiddleware, async c => {
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { message: 'Invalid setup preview request' } }, 400);
    try {
      return c.json({ ok: true, payload: previewProviderSetup(await loadProviderSetupSnapshot(c.req.param('providerId'), deps.service.currentConfig), parsed.data) });
    } catch (error) { return c.json({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } }, 400); }
  });
  app.post('/api/models/setup/:providerId/apply', deps.strictRateLimitMiddleware, async c => withGatewayConfigWriteLock(deps.service, async () => {
    const parsed = applySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { message: 'Invalid setup apply request' } }, 400);
    let voiceSaved = false;
    try {
      const expectedConfig = structuredClone(deps.service.currentConfig);
      const snapshot = await loadProviderSetupSnapshot(c.req.param('providerId'), expectedConfig);
      if (!isDeepStrictEqual(deps.service.currentConfig, expectedConfig)) throw new SetupConflictError('Configuration changed while preparing setup. Review and retry.');
      const applied = applyProviderSetup(snapshot, parsed.data, parsed.data.revision);
      const prepared = prepareUpdateGlobalDefaults({ defaults: applied.defaults });
      if (prepared.ok === false) return c.json({ ok: false, error: { message: prepared.error } }, prepared.status ?? 400);
      if (applied.voiceAssignments.length) {
        const next = applySetupVoice(expectedConfig, applied.voiceAssignments);
        const saved = await deps.service.saveConfig(next, expectedConfig);
        if (!saved.saved) return c.json({ ok: false, error: { message: `${saved.persisted ? 'Voice settings persisted but runtime reload failed' : 'Voice settings were not saved'}: ${saved.error ?? 'Configuration write failed'}` } }, saved.conflict ? 409 : 500);
        voiceSaved = true;
        if (!isDeepStrictEqual(listGlobalDefaults().defaults, snapshot.defaults)) {
          return c.json({ ok: false, error: { message: 'Voice settings saved; model defaults changed concurrently. Review the refreshed configuration before applying model uses.' } }, 409);
        }
      }
      // Defaults are rechecked after the voice save; no await precedes this write.
      const result = updateGlobalDefaults({ defaults: applied.defaults });
      if (result.ok === false) return c.json({ ok: false, error: { message: result.error } }, result.status ?? 400);
      if (result.data.changed) deps.service.refreshAgentCatalog();
      return c.json({ ok: true, payload: applied.preview });
    } catch (error) {
      return c.json({ ok: false, error: { message: (voiceSaved ? 'Voice settings saved; model setup incomplete. ' : '') + (error instanceof Error ? error.message : String(error)) } }, error instanceof SetupConflictError ? 409 : 400);
    }
  }));
}
