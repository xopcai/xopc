import { REGISTRY_COMMAND_MODULES } from '../../command-loaders.js';
import { registry as cliRegistry } from '../../registry.js';

let handlersLoadedPromise: Promise<void> | null = null;

/**
 * Force-import every CLI command module so each domain's
 * `registerSetupHandler(...)` and `registerSetupDomain(...)` side effect runs.
 * Shared by the gateway HTTP route, the agent `setup` tool, and tests.
 */
export async function ensureSetupHandlersLoaded(): Promise<void> {
  if (!handlersLoadedPromise) {
    handlersLoadedPromise = (async () => {
      cliRegistry.setSuppressLateRegistrationWarnings(true);
      try {
        await Promise.all(Object.values(REGISTRY_COMMAND_MODULES).map((load) => load()));
      } finally {
        cliRegistry.setSuppressLateRegistrationWarnings(false);
      }
    })();
  }
  return handlersLoadedPromise;
}

/** Test helper — reset lazy-load cache between tests. */
export function resetSetupHandlersLoadedForTests(): void {
  handlersLoadedPromise = null;
}
