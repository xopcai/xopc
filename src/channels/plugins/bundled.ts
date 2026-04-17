/**
 * Built-in channel plugins shipped with the core binary.
 * Manifest: each extensions/<name>/package.json field `xopc.bundledChannel`.
 * Generated: src/generated/bundled-channel-plugins.ts (pnpm run generate:bundled-channels).
 *
 * Side-effect: registers the channel config validator into the config loader so
 * that loadConfig() can validate channel sections without a static import cycle:
 *   loader → validate-channel-configs → bundled-channel-plugins →
 *   telegram/command-handler → providers → sync-provider-auth → loader
 */

import { registerChannelConfigValidator } from '../../config/loader.js';
import { assertChannelPluginConfigs } from '../../config/validate-channel-configs.js';

registerChannelConfigValidator(assertChannelPluginConfigs);

export { bundledChannelPlugins } from '../../generated/bundled-channel-plugins.js';
