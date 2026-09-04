import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { resolveStateDir } from '../../../config/paths-state.js';
import { RuntimeToolsConfigSchema, type Config } from '../../../config/schema.js';
import { ManagedRuntimeManager } from '../../../runtime-tools/manager.js';
import type { RuntimeKind, RuntimeProgressEvent } from '../../../runtime-tools/types.js';
import { pruneRuntimeTools } from '../../../runtime-tools/prune.js';
import { normalizeRuntimeVersionRequest } from '../../../runtime-tools/probe.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('RuntimeTools');
const RUNTIMES = new Set<RuntimeKind>(['node', 'uv', 'python']);

function parseRuntime(value: string): RuntimeKind | null {
  return RUNTIMES.has(value as RuntimeKind) ? value as RuntimeKind : null;
}

function runtimeManager(config: Config): ManagedRuntimeManager {
  return new ManagedRuntimeManager({
    stateDir: resolveStateDir(),
    config: config.runtimeTools,
  });
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

export function registerRuntimeToolsRoutes(
  authenticated: Hono,
  deps: AuthenticatedRouteDeps,
): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/runtime-tools', async (c) => {
    const statuses = await runtimeManager(service.currentConfig).statusAll();
    return c.json({
      ok: true,
      payload: { config: service.currentConfig.runtimeTools, statuses },
    });
  });

  authenticated.patch('/api/runtime-tools/config', strictRateLimitMiddleware, async (c) => {
    const body = await readJson(c);
    const parsed = RuntimeToolsConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        ok: false,
        error: 'invalid-config',
        message: parsed.error.issues[0]?.message ?? 'Invalid runtime tools config',
      }, 400);
    }
    const config = structuredClone(service.currentConfig);
    config.runtimeTools = parsed.data;
    const result = await service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: 'save-failed', message: result.error }, 500);
    }
    service.emit('runtime-tools.updated', { config: parsed.data });
    return c.json({ ok: true, payload: { config: parsed.data } });
  });

  authenticated.post('/api/runtime-tools/prune', strictRateLimitMiddleware, async (c) => {
    const payload = await pruneRuntimeTools({
      stateDir: resolveStateDir(),
      config: service.currentConfig.runtimeTools,
    });
    return c.json({ ok: true, payload });
  });

  const registerOperation = (action: 'install' | 'repair') => {
    authenticated.post(
      `/api/runtime-tools/:runtime/${action}/stream`,
      strictRateLimitMiddleware,
      async (c) => {
        const runtime = parseRuntime(c.req.param('runtime'));
        if (!runtime) {
          return c.json({ ok: false, error: 'invalid-runtime' }, 400);
        }
        const body = await readJson(c) as { version?: unknown };
        const version = typeof body.version === 'string' && body.version.trim()
          ? body.version.trim()
          : undefined;
        if (version && !normalizeRuntimeVersionRequest(version)) {
          return c.json({ ok: false, error: 'invalid-version', message: 'Invalid runtime version' }, 400);
        }

        return streamSSE(c, async (stream) => {
          const manager = runtimeManager(service.currentConfig);
          let writes = Promise.resolve();
          const onProgress = (event: RuntimeProgressEvent) => {
            writes = writes.then(async () => {
              try {
                await stream.writeSSE({ event: 'progress', data: JSON.stringify(event) });
              } catch {
                // Provisioning remains valid if the browser navigates away.
              }
            });
          };
          manager.on('progress', onProgress);
          try {
            const resolved = action === 'repair'
              ? await manager.repair(runtime, version)
              : await manager.install(runtime, version);
            await writes;
            await stream.writeSSE({
              event: 'result',
              data: JSON.stringify({ ok: true, payload: resolved }),
            });
            service.emit('runtime-tools.updated', { runtime, action, resolved });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.warn({ err: error, runtime, action }, `Runtime ${action} failed: ${message}`);
            await writes;
            try {
              await stream.writeSSE({
                event: 'result',
                data: JSON.stringify({ ok: false, error: `${action}-failed`, message }),
              });
            } catch {
              // Client disconnected.
            }
          } finally {
            manager.off('progress', onProgress);
          }
        });
      },
    );
  };

  registerOperation('install');
  registerOperation('repair');
}
