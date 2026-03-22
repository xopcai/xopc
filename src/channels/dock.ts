/**
 * Lightweight channel surface for gateway/UI/shared code without importing
 * GrammY or full plugin implementations (see OpenClaw ChannelDock pattern).
 */

import type { ChannelCapabilities } from './plugin-types.js';
import { getChatChannelMeta, type ChatChannelId, isChatChannelId } from './registry.js';
import { TELEGRAM_CHANNEL_DEFAULTS } from './telegram/plugin-defaults.js';

export interface ChannelDock {
  id: string;
  label: string;
  description: string;
  capabilities: ChannelCapabilities;
  outbound?: {
    textChunkLimit?: number;
  };
  queue?: {
    debounceMs?: number;
  };
}

export function getChannelDock(channelId: string): ChannelDock | undefined {
  if (!isChatChannelId(channelId)) {
    return undefined;
  }
  const meta = getChatChannelMeta(channelId);
  if (channelId === 'telegram') {
    return {
      id: meta.id,
      label: meta.label,
      description: meta.description,
      capabilities: meta.capabilities,
      outbound: {
        textChunkLimit: TELEGRAM_CHANNEL_DEFAULTS.outbound.textChunkLimit,
      },
      queue: {
        debounceMs: TELEGRAM_CHANNEL_DEFAULTS.queue.debounceMs,
      },
    };
  }
  return {
    id: meta.id,
    label: meta.label,
    description: meta.description,
    capabilities: meta.capabilities,
  };
}

export function getDockForBuiltinChannel(id: ChatChannelId): ChannelDock {
  return getChannelDock(id)!;
}
