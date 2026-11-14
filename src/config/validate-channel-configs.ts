import Ajv from 'ajv';

import type { Config } from './schema.js';
import { buildChannelCatalogForConfig } from '../channels/catalog/channel-catalog-service.js';

let ajv: Ajv | undefined;

function formatAjvError(channelId: string, err: { instancePath?: string; message?: string }): string {
  const path = err.instancePath ? err.instancePath.replaceAll('/', '.') : '';
  const suffix = path ? path : '<root>';
  return `channels.${channelId}.${suffix}: ${err.message ?? 'invalid value'}`;
}

export function validateChannelPluginConfigs(config: Config): string[] {
  const errors: string[] = [];
  const channels = Object.entries(config.channels ?? {});
  if (!channels.length) return errors;

  const catalog = buildChannelCatalogForConfig(config);
  if (!ajv) {
    ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });
    // `password` is a UI hint used by extension manifests, not a validation constraint.
    ajv.addFormat('password', true);
  }

  for (const [rawChannelId, raw] of channels) {
    const channelId = rawChannelId.trim().toLowerCase();
    const entry = catalog.byId.get(channelId);
    if (!entry) {
      errors.push(`channels.${rawChannelId}: unknown channel; install or declare a channel extension contribution`);
      continue;
    }
    const validate = ajv.compile(entry.configSchema);
    if (!validate(raw)) {
      for (const err of validate.errors ?? []) {
        errors.push(formatAjvError(channelId, err));
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
