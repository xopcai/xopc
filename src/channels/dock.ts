import type { ChannelCapabilities } from './plugin-types.js';

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
