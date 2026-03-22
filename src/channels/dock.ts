/**
 * Lightweight channel surface for gateway/UI/shared code without importing
 * GrammY or full plugin implementations (see OpenClaw ChannelDock pattern).
 */

import type { ChannelCapabilities } from './plugin-types.js';
import { getChatChannelMeta, type ChatChannelId, isChatChannelId } from './registry.js';

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
  return {
    id: meta.id,
    label: meta.label,
    description: meta.description,
    capabilities: meta.capabilities,
    ...(meta.dock?.outbound && { outbound: meta.dock.outbound }),
    ...(meta.dock?.queue && { queue: meta.dock.queue }),
  };
}

export function getDockForBuiltinChannel(id: ChatChannelId): ChannelDock {
  return getChannelDock(id)!;
}
