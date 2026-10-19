import { cancelPluginCliAuthorizations } from '../../../extensions/agent-plugins/cli-authorization.js';
import { PluginSelectionRequired } from '../../../extensions/agent-plugins/source-catalog.js';
import { PluginSetupService, setupActionSchema } from '../../../extensions/agent-plugins/setup.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { getWorkspacePath } from '../../../config/workspace-path-helpers.js';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { AgentPluginStore } from '../../../extensions/agent-plugins/store.js';
import { agentPluginInventoryRow } from '../../../extensions/agent-plugins/inventory.js';
import { savePluginAuthBinding } from '../../../extensions/agent-plugins/auth.js';
import { removePluginCredentials } from '../../../extensions/agent-plugins/credentials.js';
import { withAgentPluginSource } from '../../../extensions/agent-plugins/sources.js';
import { evictAllEmbeddedSessionRunners } from '../../../agent/embedded/session-runner.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const sourceBody = z.strictObject({ source: z.string().min(1), reviewHash: z.string().optional(), setup: z.boolean().optional() });
function setupOwner(c: Context): string {
  const principal = getGatewayPrincipal(c);
  return principal.kind === 'owner' ? 'gateway-owner' : principal.principalId;
}
export function registerAgentPluginRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const store = new AgentPluginStore();
  const setup = new PluginSetupService(store);
  const refresh = async () => {
    evictAllEmbeddedSessionRunners();
    deps.service.marketplace.reloadSkills();
  };
  app.post('/api/extensions/inspect', deps.strictRateLimitMiddleware, async c => {
    try { const body = sourceBody.parse(await c.req.json()); return c.json({ ok: true, payload: await withAgentPluginSource(body.source, deps.service.currentConfig, (source, _provenance, resolvedCommit, importManifest) => ({ ...store.inspect(source, body.source, importManifest), resolvedCommit })) }); }
    catch (error) { if (error instanceof PluginSelectionRequired) return c.json({ ok: true, payload: { candidates: error.candidates } }); return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post('/api/extensions/install', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = sourceBody.parse(await c.req.json());
      const plugin = await withAgentPluginSource(body.source, deps.service.currentConfig, (source, provenance, resolvedCommit, importManifest) => store.install(source, { reviewHash: body.reviewHash, sourceLabel: body.source, provenance, resolvedCommit, importManifest }));
      if (body.setup && plugin.readiness !== 'blocked') {
        setup.create(plugin.id, setupOwner(c));
      }
      await refresh();
      return c.json({ ok: true, payload: agentPluginInventoryRow(store.get(plugin.id)!) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.get('/api/extensions/agent-plugins/:id', c => {
    try {
      const plugin = store.pending(c.req.param('id')) ?? store.get(c.req.param('id'));
      return plugin ? c.json({ ok: true, payload: agentPluginInventoryRow(plugin) }) : c.json({ ok: false, error: 'Plugin not found' }, 404);
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.get('/api/extensions/agent-plugins/:id/setup', c => {
    try { const id = c.req.param('id'), job = setup.get(id, setupOwner(c)); const plugin = store.pending(id) ?? store.get(id); return c.json({ ok: true, payload: job?.packageRevision === plugin?.receipt.revision ? job : null }); }
    catch { return c.json({ ok: false, error: 'Setup unavailable' }, 403); }
  });
  app.get('/api/extensions/agent-plugins/:id/setup/reusable', async c => {
    try { return c.json({ ok: true, payload: await setup.reusableConnections(c.req.param('id'), setupOwner(c), deps.service.currentConfig) }); }
    catch { return c.json({ ok: false, error: 'Reusable connections unavailable' }, 400); }
  });
  app.post('/api/extensions/agent-plugins/:id/setup', deps.strictRateLimitMiddleware, async c => {
    try {
      const id = c.req.param('id'), owner = setupOwner(c);
      const body = await c.req.json();
      if (body.action === 'start') return c.json({ ok: true, payload: setup.create(id, owner) });
      const action = setupActionSchema.parse(body);
      if (action.action === 'prepare') return c.json({ ok: true, payload: setup.startPrepare(id, owner, action.expectedRevision, deps.service.currentConfig, getWorkspacePath(deps.service.currentConfig) || process.cwd(), action.idempotencyKey) });
      const job = await setup.act(id, owner, action, deps.service.currentConfig, getWorkspacePath(deps.service.currentConfig) || process.cwd());
      await refresh();
      return c.json({ ok: true, payload: job });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : 'Setup failed' }, 400); }
  });
  app.get('/api/extensions/agent-plugins/:id/setup/auth/:server', async c => {
    try {
      const result = await setup.authorization(c.req.param('id'), setupOwner(c), c.req.param('server'), deps.service.currentConfig);
      return c.json({ ok: true, payload: result ?? null });
    } catch { return c.json({ ok: false, error: 'Authorization unavailable' }, 400); }
  });
  app.post('/api/extensions/agent-plugins/:id/setup/auth/:server/redirect', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = z.strictObject({ url: z.string().max(16384) }).parse(await c.req.json());
      if (!setup.redirect(c.req.param('id'), setupOwner(c), c.req.param('server'), body.url, deps.service.currentConfig)) throw new Error('Callback does not match this sign-in');
      return c.json({ ok: true });
    } catch { return c.json({ ok: false, error: 'Invalid sign-in callback' }, 400); }
  });
  app.post('/api/extensions/agent-plugins/:id/activation', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = z.strictObject({ enabled: z.boolean() }).parse(await c.req.json());
      const job = setup.get(c.req.param('id'), setupOwner(c));
      if (body.enabled && job?.packageRevision === store.receipt(c.req.param('id'))?.revision && job.state !== 'completed') throw new Error('Finish plugin setup before enabling');
      const plugin = store.setEnabled(c.req.param('id'), body.enabled);
      await refresh();
      return c.json({ ok: true, payload: agentPluginInventoryRow(plugin) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post('/api/extensions/agent-plugins/:id/update', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = sourceBody.parse(await c.req.json());
      const plugin = await withAgentPluginSource(body.source, deps.service.currentConfig, (source, provenance, resolvedCommit, importManifest) => store.install(source, { reviewHash: body.reviewHash, replace: true, expectedId: c.req.param('id'), stage: body.setup, sourceLabel: body.source, provenance, resolvedCommit, importManifest }));
      if (body.setup && plugin.readiness !== 'blocked') setup.create(plugin.id, setupOwner(c));
      await refresh();
      return c.json({ ok: true, payload: agentPluginInventoryRow(store.pending(plugin.id) ?? store.get(plugin.id)!) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post('/api/extensions/agent-plugins/:id/rollback', deps.strictRateLimitMiddleware, async c => {
    try {
      const plugin = store.rollback(c.req.param('id'));
      await refresh();
      return c.json({ ok: true, payload: agentPluginInventoryRow(plugin) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.put('/api/extensions/agent-plugins/:id/mcp/:server/auth', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = z.strictObject({ mode: z.enum(['auto', 'api-key']), secrets: z.array(z.strictObject({ target: z.enum(['headers', 'env']), key: z.string(), value: z.string(), prefix: z.string().optional() })).max(20).optional() }).parse(await c.req.json());
      const owner = setupOwner(c);
      setup.get(c.req.param('id'), owner);
      await savePluginAuthBinding(store, c.req.param('id'), c.req.param('server'), body);
      setup.invalidateConnection(c.req.param('id'), owner, c.req.param('server'));
      await refresh();
      return c.json({ ok: true });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.delete('/api/extensions/agent-plugins/:id', deps.strictRateLimitMiddleware, async c => {
    try {
      cancelPluginCliAuthorizations(c.req.param('id'));
      const body = z.strictObject({ removeData: z.boolean().optional(), removeCredentials: z.boolean().optional() }).parse(await c.req.json());
      evictAllEmbeddedSessionRunners();
      if (body.removeCredentials) await removePluginCredentials(store, c.req.param('id'));
      store.remove(c.req.param('id'), body.removeData);
      deps.service.marketplace.reloadSkills();
      return c.json({ ok: true });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
}
