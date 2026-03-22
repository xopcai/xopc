import type { ChannelGroupAdapter } from '@xopcai/xopcbot/channels/plugin-types.js';

/**
 * Group access and mention rules are enforced via `security-adapter` and inbound processing.
 */
export function createTelegramGroupAdapter(): ChannelGroupAdapter | undefined {
  return undefined;
}
