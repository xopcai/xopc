import type { PairingCliChannel } from './pairing-channel.js';
import { approveChannelPairing } from './pairing-service.js';

export function approveChannelPairingFromCli(params: {
  channel: PairingCliChannel;
  accountId: string;
  code: string;
}): { ok: true; senderId: string } | { ok: false; error: string } {
  const result = approveChannelPairing({
    channel: params.channel,
    accountId: params.accountId,
    code: params.code,
  });
  if (result.ok === false) return result;
  return { ok: true, senderId: result.senderId };
}
