import { ExtensionLoader } from '../../extensions/loader.js';
import type { ExtensionRegistryImpl } from '../../extensions/loader.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { resolveExtensionsDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TUI:Extensions');

/** Load activated extensions for embedded TUI (shared registry with AgentService). */
export async function loadExtensionsForTuiLocalMode(runtime?: {
  setLabel?: (entryId: string, label: string | undefined) => void;
  sendUserMessage?: import('../../extensions/types/core.js').ExtensionRuntime['sendUserMessage'];
  appendEntry?: import('../../extensions/types/core.js').ExtensionRuntime['appendEntry'];
  sendMessage?: import('../../extensions/types/core.js').ExtensionRuntime['sendMessage'];
}): Promise<ExtensionRegistryImpl> {
  const config = loadConfig();
  const workspaceDir = getWorkspacePath(config);
  const loader = new ExtensionLoader({
    workspaceDir,
    extensionsDir: resolveExtensionsDir(),
  });
  loader.setConfig(config);
  if (runtime) {
    loader.setRuntimeContext(runtime);
  }
  try {
    await loader.loadByActivationPlan();
    const registry = loader.getRegistry();
    log.info(
      {
        extensions: registry.extensions.size,
        tuiRegistrations: registry.getTuiRegistrations().length,
      },
      'Extensions loaded for local TUI',
    );
    return registry;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn({ err, errorMessage }, `Extension load for TUI failed: ${errorMessage}`);
    return loader.getRegistry();
  }
}
