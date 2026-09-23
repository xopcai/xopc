import type { Hono } from 'hono';
import { z } from 'zod';
import { AgentPluginStore } from '../../../extensions/agent-plugins/store.js';
import { agentPluginInventoryRow } from '../../../extensions/agent-plugins/inventory.js';
import { savePluginAuthBinding, removePluginCredentials } from '../../../extensions/agent-plugins/auth.js';
import { withAgentPluginSource } from '../../../extensions/agent-plugins/sources.js';
import { disposeAllSessionMcpRuntimes } from '../../../agent/mcp/bundle-mcp-runtime.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const sourceBody = z.strictObject({ source: z.string().min(1), reviewHash: z.string().optional() });
export function registerAgentPluginRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const store = new AgentPluginStore();
  const refresh = async () => {
    await disposeAllSessionMcpRuntimes();
    deps.service.marketplace.reloadSkills();
  };
  app.post('/api/extensions/inspect', deps.strictRateLimitMiddleware, async c => {
    try { const body = sourceBody.parse(await c.req.json()); return c.json({ ok: true, payload: await withAgentPluginSource(body.source, deps.service.currentConfig, source => store.inspect(source)) }); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post('/api/extensions/install', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = sourceBody.parse(await c.req.json());
      const plugin = await withAgentPluginSource(body.source, deps.service.currentConfig, source => store.install(source, { reviewHash: body.reviewHash, sourceLabel: body.source }));
      await refresh();
      return c.json({ ok: true, payload: agentPluginInventoryRow(plugin) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.get('/api/extensions/agent-plugins/:id', c => {
    try {
      const plugin = store.get(c.req.param('id'));
      return plugin ? c.json({ ok: true, payload: agentPluginInventoryRow(plugin) }) : c.json({ ok: false, error: 'Plugin not found' }, 404);
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post('/api/extensions/agent-plugins/:id/activation', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = z.strictObject({ enabled: z.boolean() }).parse(await c.req.json());
      const plugin = store.setEnabled(c.req.param('id'), body.enabled);
      await refresh();
      return c.json({ ok: true, payload: agentPluginInventoryRow(plugin) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post('/api/extensions/agent-plugins/:id/update', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = sourceBody.parse(await c.req.json());
      const plugin = await withAgentPluginSource(body.source, deps.service.currentConfig, source => store.install(source, { reviewHash: body.reviewHash, replace: true, expectedId: c.req.param('id'), sourceLabel: body.source }));
      await refresh();
      return c.json({ ok: true, payload: agentPluginInventoryRow(plugin) });
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
      const body = z.strictObject({ mode: z.enum(['auto', 'oauth', 'api-key', 'none']), secrets: z.array(z.strictObject({ target: z.enum(['headers', 'env']), key: z.string(), value: z.string(), prefix: z.string().optional() })).max(20).optional() }).parse(await c.req.json());
      await savePluginAuthBinding(store, c.req.param('id'), c.req.param('server'), body);
      await refresh();
      return c.json({ ok: true });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.delete('/api/extensions/agent-plugins/:id', deps.strictRateLimitMiddleware, async c => {
    try {
      const body = z.strictObject({ removeData: z.boolean().optional(), removeCredentials: z.boolean().optional() }).parse(await c.req.json());
      await disposeAllSessionMcpRuntimes();
      if (body.removeCredentials) await removePluginCredentials(store, c.req.param('id'));
      store.remove(c.req.param('id'), body.removeData);
      deps.service.marketplace.reloadSkills();
      return c.json({ ok: true });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
}
