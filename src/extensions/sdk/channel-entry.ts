/**
 * Channel plugin entry helper for extensions (OpenClaw-style).
 */

import type { ExtensionApi } from '../types/index.js';
import type { ChannelPlugin } from '../../channels/plugin-types.js';

export interface DefineChannelPluginEntryOptions<TPlugin extends ChannelPlugin> {
  id: string;
  name: string;
  description?: string;
  plugin: TPlugin;
  setRuntime?: (runtime: unknown) => void;
  registerFull?: (api: ExtensionApi) => void;
}

export function defineChannelPluginEntry<TPlugin extends ChannelPlugin>(
  options: DefineChannelPluginEntryOptions<TPlugin>,
) {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    register(api: ExtensionApi) {
      options.setRuntime?.(api as unknown);
      api.registerChannel({ plugin: options.plugin });
      options.registerFull?.(api);
    },
  };
}
