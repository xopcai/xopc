import type { PairingCliChannel } from './pairing-channel.js';

export function buildPairingInstructionText(params: {
  channel: PairingCliChannel;
  accountId: string;
  code: string;
  senderIdLine: string;
}): string {
  const { channel, accountId, code, senderIdLine } = params;
  const acc =
    !accountId || accountId.trim().toLowerCase() === 'default' ? '' : ` --account ${accountId.trim()}`;
  const approve = `xopc channels pairing approve --channel ${channel}${acc} ${code}`;
  return [
    'XOPC: this bot is in pairing mode.',
    '',
    senderIdLine,
    'Pairing code:',
    code,
    '',
    'Ask the owner to approve in Settings → Channels → Pairing, or run:',
    approve,
  ].join('\n');
}
