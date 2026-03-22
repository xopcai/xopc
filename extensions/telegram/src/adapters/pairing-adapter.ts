import type { ChannelPairingAdapter } from '@xopcai/xopcbot/channels/plugins/types.adapters.js';

/**
 * DM pairing is covered by `dmPolicy` and security evaluation, not a separate pairing flow yet.
 */
export function createTelegramPairingAdapter(): ChannelPairingAdapter | undefined {
  return undefined;
}
