import type { Config } from '../../config/schema.js';
import { createBrowserActionRegistry } from '../actions/registry.js';
import { resolveBrowserBackendFromConfig } from '../backend-from-config.js';
import { BrowserManager } from '../manager.js';
import { runBrowserPipeline } from '../pipeline/runner.js';
import { BrowserRecipeService } from './service.js';

export function createRuntimeBrowserRecipeService(deps: {
  getConfig: () => Config;
  emit?: (type: string, payload: unknown) => void;
}): BrowserRecipeService {
  const registry = createBrowserActionRegistry();
  return new BrowserRecipeService(
    registry,
    async ({ yaml, args, signal, onStep }) => {
      const manager = new BrowserManager({
        getHeadless: () => false,
        getBackend: () => resolveBrowserBackendFromConfig(deps.getConfig()),
      });
      const taskId = `recipe-${Date.now()}`;
      try {
        await manager.ensureConnected();
        const page = manager.getExtensionProvider() ? null as never : await manager.getPage(taskId);
        return await runBrowserPipeline(
          yaml,
          args,
          { page, manager, config: deps.getConfig(), taskId, signal },
          registry,
          { onStep },
        );
      } finally {
        await manager.shutdown().catch(() => undefined);
      }
    },
    deps.emit,
  );
}
