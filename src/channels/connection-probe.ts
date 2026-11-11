import { randomUUID } from 'node:crypto';

import type { ChannelRuntimeActionPayload } from './plugins/types.adapters.js';

const LIFETIME_MS = 5 * 60_000;

type Probe = {
  id: string;
  code: string;
  expiresAt: number;
  ownerId?: string;
  identity?: string;
  claimant?: string;
  confirmOwner: boolean;
  sending: boolean;
  verified: boolean;
};

const probes = new Map<string, Probe>();
const probeKey = (channel: string, accountId: string) => JSON.stringify([channel, accountId]);

export function startChannelConnectionProbe(params: {
  channel: string;
  accountId: string;
  ownerId?: string;
  identity?: string;
  confirmOwner?: boolean;
  botUsername?: string;
  configChanged?: boolean;
  zh: boolean;
}): ChannelRuntimeActionPayload {
  const { channel, accountId, ownerId, identity, botUsername, zh } = params;
  const id = randomUUID();
  const code = `xopc_${randomUUID().replaceAll('-', '')}`;
  const key = probeKey(channel, accountId);
  const probe = {
    id, code, expiresAt: Date.now() + LIFETIME_MS, ownerId, identity,
    confirmOwner: params.confirmOwner ?? false, sending: false, verified: false,
  };
  probes.set(key, probe);
  setTimeout(() => {
    if (probes.get(key) === probe) probes.delete(key);
  }, LIFETIME_MS).unref();

  const link = botUsername ? `https://t.me/${encodeURIComponent(botUsername)}?start=${code}` : undefined;
  return {
    type: 'qr',
    conversationId: id,
    accountId,
    ...(link ? { qrPayload: link } : { verificationCode: code }),
    statusAction: 'setup.verify.status',
    cancelAction: 'setup.verify.cancel',
    pollIntervalMs: 1500,
    expiresInSec: LIFETIME_MS / 1000,
    configChanged: params.configChanged,
    message: link
      ? (zh ? '凭据已验证。在 Telegram 打开机器人并点击开始。' : 'Credentials verified. Open the bot in Telegram and tap Start.')
      : (zh ? '已授权。请在机器人私聊中发送下方验证码。' : 'Authorized. Send the code below in a private chat with the bot.'),
  };
}

export function getChannelConnectionProbe(
  channel: string,
  accountId: string,
  id: string,
  zh: boolean,
): ChannelRuntimeActionPayload {
  const probe = findProbe(channel, accountId, id);
  if (!probe) return { type: 'poll', phase: 'unknown', ok: false, message: zh ? '验证已结束，请重新连接。' : 'Verification ended. Connect again to retry.' };
  if (probe.verified) return { type: 'poll', phase: 'done', ok: true, message: zh ? '已连接，双向收发已验证。' : 'Connected. Message delivery verified in both directions.' };
  if (probe.claimant && probe.confirmOwner) {
    return {
      type: 'poll', phase: 'done',
      confirmAction: 'setup.verify.confirm',
      conversationId: id,
      accountId,
      message: zh ? `Telegram 已收到验证回复。请确认用户 ${probe.claimant}。` : `Telegram received the test reply. Confirm user ${probe.claimant}.`,
    };
  }
  return {
    type: 'poll', phase: 'pending',
    message: zh ? '等待机器人收到验证消息并回复。' : 'Waiting for the bot to receive the test message and reply.',
  };
}

function findProbe(channel: string, accountId: string, id: string): Probe | undefined {
  const probe = probes.get(probeKey(channel, accountId));
  if (probe?.id === id && probe.expiresAt > Date.now()) return probe;
}

export function cancelChannelConnectionProbe(channel: string, accountId: string, id: string): void {
  if (findProbe(channel, accountId, id)) probes.delete(probeKey(channel, accountId));
}

export function getChannelConnectionClaimant(channel: string, accountId: string, id: string, identity: string): string | undefined {
  const probe = findProbe(channel, accountId, id);
  if (probe?.confirmOwner && probe.identity === identity) return probe.claimant;
}

export function confirmChannelConnectionProbe(channel: string, accountId: string, id: string): void {
  const probe = findProbe(channel, accountId, id);
  if (probe?.claimant) probe.verified = true;
}

export async function handleChannelConnectionProbe(params: {
  channel: string;
  accountId: string;
  senderId: string;
  identity?: string;
  text: string;
  reply: (text: string) => Promise<unknown>;
}): Promise<boolean> {
  const probe = probes.get(probeKey(params.channel, params.accountId));
  const code = params.text.trim().replace(/^\/start(?:@[\w_]+)?\s+/, '');
  if (!/^xopc_[a-f0-9]{32}$/.test(code)) return false;
  if (!probe || probe.code !== code || probe.expiresAt <= Date.now()
    || (probe.identity && params.identity !== probe.identity)
    || (probe.ownerId && params.senderId !== probe.ownerId)
    || probe.sending || probe.claimant || probe.verified) return true;

  probe.sending = true;
  try {
    await params.reply('xopc ✓');
    probe.claimant = params.senderId;
    probe.verified = !probe.confirmOwner;
  } finally {
    probe.sending = false;
  }
  return true;
}
