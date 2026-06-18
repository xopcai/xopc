import type { Config } from '../../../../config/schema.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function applyChannelsPatch(config: Config, body: unknown): void {
  if (!isRecord(body)) return;
  const patchChannels = body.channels;
  if (!isRecord(patchChannels)) return;

  if (!config.channels) {
    config.channels = {};
  }

  for (const [rawChannelId, patch] of Object.entries(patchChannels)) {
    const channelId = rawChannelId.trim().toLowerCase();
    if (!channelId) continue;

    if (patch === null) {
      delete (config.channels as Record<string, unknown>)[channelId];
      continue;
    }

    if (!isRecord(patch)) continue;

    const existing = (config.channels as Record<string, unknown>)[channelId];
    (config.channels as Record<string, unknown>)[channelId] = {
      ...(isRecord(existing) ? existing : {}),
      ...patch,
    };
  }
}
