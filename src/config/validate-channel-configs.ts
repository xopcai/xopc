import type { Config } from './schema.js';
import { bundledChannelPlugins } from '../generated/bundled-channel-plugins.js';

/**
 * Run each registered channel plugin's optional `configSchema.validate` on the matching subtree.
 */
export function validateChannelPluginConfigs(config: Config): string[] {
  const errors: string[] = [];
  const channelsCfg = config.channels ?? {};
  for (const [channelId, raw] of Object.entries(channelsCfg)) {
    const plugin = bundledChannelPlugins.find((p) => p.id === channelId);
    const validate = plugin?.configSchema?.validate;
    if (typeof validate !== 'function') continue;
    const result = validate(raw);
    if (!result.ok) {
      for (const e of result.errors ?? ['Invalid configuration']) {
        errors.push(`channels.${channelId}: ${e}`);
      }
    }
  }
  return errors;
}

export function assertChannelPluginConfigs(config: Config): void {
  const errs = validateChannelPluginConfigs(config);
  if (errs.length === 0) return;
  throw new Error(`Channel configuration failed validation:\n${errs.join('\n')}`);
}
