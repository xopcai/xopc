import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import { resolveStateDir } from '../../../config/paths-state.js';
import { resolveAdbPath } from '../../../phone/adb-driver.js';
import { getPhoneRuntime } from '../../../phone/runtime.js';
import { PhoneDependencyManager, probePhoneAdb, type PhoneDependencyProgress } from '../../../runtime-tools/phone-dependencies.js';
import { RuntimeError } from '../../../runtime-tools/errors.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerPhoneDependencyRoutes(parent: Hono, deps: AuthenticatedRouteDeps): void {
  const app = new Hono();
  const base = '/api/runtime-tools/phone-dependencies';
  const manager = () => new PhoneDependencyManager({ stateDir: resolveStateDir(), config: deps.service.currentConfig.runtimeTools, adbPath: deps.service.currentConfig.phone.adbPath });
  const adbBusy = () => getPhoneRuntime().reports().some(report => report.status !== 'closed');
  app.use(`${base}/*`, bodyLimit({ maxSize: 8192 }));
  const admin: MiddlewareHandler = async (c, next) => {
    const principal = getGatewayPrincipal(c);
    if (!['owner', 'trusted-proxy'].includes(principal.kind) || !principal.scopes.includes('gateway.admin'))
      return c.json({ ok: false, message: 'Gateway administrator access is required' }, 403);
    return next();
  };
  app.use(base, admin);
  app.use(`${base}/*`, admin);
  app.onError((error, c) => c.json({ ok: false, message: error instanceof z.ZodError ? 'Invalid dependency request' : error.message,
    error: error instanceof RuntimeError ? error.code : 'PHONE_DEPENDENCY_FAILED' }, 400));
  app.get(base, async c => {
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: { location: 'gateway', installationEnabled: deps.service.currentConfig.runtimeTools.enabled, statuses: await manager().status() } });
  });
  app.post(`${base}/adb/path`, deps.strictRateLimitMiddleware, async c => {
    const { path } = z.object({ path: z.string().trim().max(4096) }).strict().parse(await c.req.json());
    if (adbBusy()) return c.json({ ok: false, message: 'Close the current phone session before changing ADB', error: 'PHONE_DEPENDENCY_BUSY' }, 409);
    if (path && !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) return c.json({ ok: false, message: 'Enter an absolute ADB executable path on the Gateway host' }, 400);
    await probePhoneAdb(resolveAdbPath(path || undefined));
    const next = structuredClone(deps.service.currentConfig); next.phone.adbPath = path || undefined;
    const saved = await deps.service.saveConfig(next);
    if (!saved.saved) return c.json({ ok: false, message: 'Could not save the ADB path' }, 500);
    deps.service.emit('runtime-tools.updated', { dependency: 'adb' });
    return c.json({ ok: true });
  });
  app.post(`${base}/:kind/:action/stream`, deps.strictRateLimitMiddleware, async c => {
    const kind = z.enum(['adb', 'scrcpy']).parse(c.req.param('kind'));
    const action = z.enum(['install', 'repair', 'import']).parse(c.req.param('action'));
    const input = z.object({ path: z.string().trim().min(1).max(4096).optional() }).strict().parse(await c.req.json());
    if (action === 'import' && (kind !== 'scrcpy' || !input.path) || action !== 'import' && input.path) return c.json({ ok: false, message: 'Only scrcpy server imports accept a file path' }, 400);
    if (kind === 'adb' && adbBusy()) return c.json({ ok: false, message: 'Close the current phone session before installing or repairing ADB', error: 'PHONE_DEPENDENCY_BUSY' }, 409);
    const runtime = manager();
    return streamSSE(c, async stream => {
      let writes = Promise.resolve();
      const progress = (event: PhoneDependencyProgress) => {
        writes = writes.then(async () => { try { await stream.writeSSE({ event: 'progress', data: JSON.stringify(event) }); } catch { /* Installation outlives a closed page. */ } });
      };
      runtime.on('progress', progress);
      try {
        await runtime.install(kind, { repair: action === 'repair', sourcePath: input.path });
        await writes;
        deps.service.emit('runtime-tools.updated', { dependency: kind });
        await stream.writeSSE({ event: 'result', data: JSON.stringify({ ok: true }) });
      } catch (error) {
        await writes;
        try { await stream.writeSSE({ event: 'result', data: JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error), error: error instanceof RuntimeError ? error.code : 'PHONE_DEPENDENCY_FAILED' }) }); } catch { /* Client disconnected. */ }
      } finally { runtime.off('progress', progress); }
    });
  });
  parent.route('/', app);
}
