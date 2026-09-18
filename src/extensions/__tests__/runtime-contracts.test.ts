import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/config-surface.js';
import { ExtensionApiImpl, createExtensionLogger } from '../api.js';
import { ExtensionHookRunner } from '../hooks.js';
import { ExtensionLoader } from '../loader.js';
import { ExtensionRegistryImpl } from '../extension-registry-impl.js';

const tempDirs: string[] = [];
const minimalConfig = { agents: {} } as Config;

function createApi(registry: ExtensionRegistryImpl): ExtensionApiImpl {
  return new ExtensionApiImpl(
    'runtime-test',
    'Runtime Test',
    '1.0.0',
    '/tmp/runtime-test',
    minimalConfig,
    {},
    createExtensionLogger('runtime-test'),
    (path) => path,
    registry,
    { hooks: ['before_agent_start'] },
  );
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('extension runtime contracts', () => {
  it('runs hooks by descending priority and removes once handlers', async () => {
    const registry = new ExtensionRegistryImpl();
    const api = createApi(registry);
    const calls: string[] = [];
    api.registerHook('before_agent_start', async () => calls.push('low'), { priority: 1 });
    api.registerHook('before_agent_start', async () => calls.push('once'), {
      priority: 10,
      once: true,
    });

    const runner = new ExtensionHookRunner(registry);
    await runner.runHooks('before_agent_start', {}, {} as never);
    await runner.runHooks('before_agent_start', {}, {} as never);

    expect(calls).toEqual(['once', 'low', 'low']);
  });

  it('registers typed hooks in the central runner', async () => {
    const registry = new ExtensionRegistryImpl();
    const api = createApi(registry);
    const handler = vi.fn(async () => undefined);
    api.onHook('before_agent_start', handler);

    await new ExtensionHookRunner(registry).runHooks('before_agent_start', {}, {} as never);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('namespaces HTTP routes by extension id', () => {
    const registry = new ExtensionRegistryImpl();
    const first = vi.fn(async () => ({ status: 200, body: 'first' }));
    const second = vi.fn(async () => ({ status: 200, body: 'second' }));
    registry.addHttpRoute('/health', first, 'first');
    registry.addHttpRoute('/health', second, 'second');

    expect(registry.getHttpRoute('first', '/health')).toBe(first);
    expect(registry.getHttpRoute('second', '/health')).toBe(second);
  });

  it('activates, starts, stops, deactivates, and removes owned contributions', async () => {
    const path = mkdtempSync(join(tmpdir(), 'xopc-runtime-contract-'));
    tempDirs.push(path);
    writeFileSync(
      join(path, 'xopc.extension.json'),
      JSON.stringify({
        id: 'runtime-lifecycle',
        name: 'Runtime Lifecycle',
        version: '1.0.0',
        main: 'index.mjs',
        engines: { xopc: '>=0.0.0' },
        contracts: { services: ['runtime-service'] },
      }),
    );
    writeFileSync(
      join(path, 'index.mjs'),
      `const state = { activated: 0, started: 0, stopped: 0, deactivated: 0 };
       export default {
         state,
         register(api) {
           api.registerService({
             id: 'runtime-service',
             start() { state.started += 1; },
             stop() { state.stopped += 1; }
           });
         },
         activate() { state.activated += 1; },
         deactivate() { state.deactivated += 1; }
       };`,
    );

    const loader = new ExtensionLoader({ workspaceDir: path, extensionsDir: path });
    loader.setSecurityConfig({ allowUntrusted: true });
    const api = await loader.loadExtension({
      id: 'runtime-lifecycle',
      name: 'Runtime Lifecycle',
      path,
      enabled: true,
      config: {},
      source: 'global',
    });
    expect(api?.source).toBe(path);
    const record = loader.getRegistry().getExtension('runtime-lifecycle');
    const state = (record?.module as unknown as { state: Record<string, number> }).state;

    await loader.startServices();
    await loader.startServices();
    expect(state).toMatchObject({ activated: 1, started: 1, stopped: 0, deactivated: 0 });

    await expect(loader.unloadExtension('runtime-lifecycle')).resolves.toBe(true);
    expect(state).toMatchObject({ activated: 1, started: 1, stopped: 1, deactivated: 1 });
    expect(loader.getRegistry().getService('runtime-service')).toBeUndefined();
    expect(loader.getRegistry().getExtension('runtime-lifecycle')).toBeUndefined();
  });
});
