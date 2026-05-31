import type { Config } from '../../config/schema.js';

import {
  initWorkspaceCore,
  type InitWorkspaceCoreOptions,
  type InitWorkspaceResult,
} from './init-workspace-core.js';

export type { InitWorkspaceResult };

export interface InitWorkspaceOptions extends Omit<InitWorkspaceCoreOptions, 'assertChannelPlugins'> {
  /**
   * When true, only {@link ConfigSchema} (Zod) runs; bundled channel plugins are not loaded and
   * their `configSchema.validate` hooks are skipped. Use from the Electron main process so the
   * desktop shell does not import the full channel graph (e.g. Telegram → providers → pi-ai).
   * CLI / gateway should leave this false so plugin rules run here; the gateway still validates
   * on startup after the channel config validator is registered.
   */
  skipChannelPluginValidation?: boolean;
}

/**
 * Single idempotent workspace + config initialisation for CLI, gateway, onboard, and Electron.
 * Skips saveConfig (and backup rotation) when the persisted JSON would be unchanged.
 *
 * Electron main should import {@link initWorkspaceCore} directly to avoid bundling channel plugins.
 */
export async function initWorkspace(options: InitWorkspaceOptions): Promise<InitWorkspaceResult> {
  const skipChannelPluginValidation = options.skipChannelPluginValidation ?? false;
  let assertChannelPlugins: ((cfg: Config) => void | Promise<void>) | undefined;
  if (!skipChannelPluginValidation) {
    const { assertChannelPluginConfigs } = await import('../../config/validate-channel-configs.js');
    assertChannelPlugins = assertChannelPluginConfigs;
  }
  const { skipChannelPluginValidation: _skip, ...coreOptions } = options;
  return initWorkspaceCore({ ...coreOptions, assertChannelPlugins });
}
