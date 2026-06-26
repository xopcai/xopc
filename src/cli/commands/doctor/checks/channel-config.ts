import { existsSync } from 'node:fs';

import {
  buildChannelCatalogForConfig,
  getChannelSetupStatus,
} from '../../../../channels/catalog/channel-catalog-service.js';
import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import type { CheckResult, DoctorContext } from '../types.js';

function isEnabledChannelConfig(value: unknown): value is { enabled: true } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { enabled?: unknown }).enabled === true;
}

export async function checkChannelConfig(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  let cfg: Config;
  try {
    cfg = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  const channels = cfg.channels as Record<string, unknown> | undefined;
  const enabledIds = Object.entries(channels ?? {})
    .filter(([, value]) => isEnabledChannelConfig(value))
    .map(([id]) => id);

  if (enabledIds.length === 0) {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'skip',
      message: 'No channels enabled; skipped.',
      hints: [],
    };
  }

  const catalog = buildChannelCatalogForConfig(cfg);
  const unknownIds = enabledIds.filter((id) => !catalog.byId.has(id));
  if (unknownIds.length > 0) {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'fail',
      message: `Enabled channel(s) are not declared by installed extensions: ${unknownIds.join(', ')}.`,
      hints: ['Install or enable an extension that declares each channel contribution.'],
    };
  }

  const notReady = enabledIds
    .map((id) => ({ id, status: getChannelSetupStatus(cfg, id, catalog.byId.get(id)) }))
    .filter((item) => !item.status.ready);
  if (notReady.length > 0) {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'fail',
      message: `Enabled channel(s) need setup before they can run: ${notReady.map((item) => item.id).join(', ')}.`,
      hints: notReady.flatMap((item) => {
        const issues = item.status.issues.length > 0
          ? item.status.issues.map((issue) => `${item.id}: ${issue.message}`)
          : [`${item.id}: complete the required channel setup or disable the channel.`];
        return issues;
      }),
    };
  }

  return {
    id: 'channel-config',
    label: 'Channels',
    status: 'pass',
    message: `Enabled channel configuration loaded for: ${enabledIds.join(', ')}.`,
    hints: [],
  };
}
