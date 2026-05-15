import type { PairingCliChannel } from './pairing-channel.js';
import { approvePairingCodeSync } from './pairing-store.js';
import {
  resolveStandardAllowFromPath,
  resolveStandardPairingPath,
  resolveWeixinAllowFromPath,
  resolveWeixinPairingPath,
} from './paths.js';

export function approveChannelPairingFromCli(params: {
  channel: PairingCliChannel;
  accountId: string;
  code: string;
}): { ok: true; senderId: string } | { ok: false; error: string } {
  const accountId = params.accountId.trim() || 'default';
  const code = params.code.trim();
  if (!code) return { ok: false, error: 'Missing pairing code.' };

  let pairingPath: string;
  let allowPath: string;
  if (params.channel === 'weixin') {
    pairingPath = resolveWeixinPairingPath(accountId);
    allowPath = resolveWeixinAllowFromPath(accountId);
  } else if (params.channel === 'telegram' || params.channel === 'feishu') {
    pairingPath = resolveStandardPairingPath(params.channel, accountId);
    allowPath = resolveStandardAllowFromPath(params.channel, accountId);
  } else {
    return { ok: false, error: `Unknown channel: ${String(params.channel)}` };
  }

  const result = approvePairingCodeSync({
    pairingFilePath: pairingPath,
    allowFromFilePath: allowPath,
    code,
    accountId,
  });
  if (!result) {
    return { ok: false, error: 'Invalid or expired pairing code (or wrong --account).' };
  }
  return { ok: true, senderId: result.senderId };
}
