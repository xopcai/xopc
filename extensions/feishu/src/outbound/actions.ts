import type { Config } from '@xopcai/xopc/config/schema.js';

import { resolveFeishuAccount } from '../state/accounts.js';
import { createFeishuClient } from '../transport/client/client.js';

export async function editMessageFeishu(params: {
  cfg: Config;
  accountId?: string;
  messageId: string;
  text: string;
}): Promise<{ ok: boolean }> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  const { api } = createFeishuClient(account);
  await (api as any).im.v1.message.update({
    path: { message_id: params.messageId },
    data: {
      msg_type: 'text',
      content: JSON.stringify({ text: params.text }),
    },
  });
  return { ok: true };
}

export async function getMessageFeishu(params: {
  cfg: Config;
  accountId?: string;
  messageId: string;
}): Promise<any> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  const { api } = createFeishuClient(account);
  const res = await (api as any).im.message.get({
    path: { message_id: params.messageId },
  });
  return res?.data ?? res;
}

export async function addReactionFeishu(params: {
  cfg: Config;
  accountId?: string;
  messageId: string;
  emojiType: string;
}): Promise<any> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  const { api } = createFeishuClient(account);
  return await (api as any).im.v1.messageReaction.create({
    path: { message_id: params.messageId },
    data: {
      reaction_type: { emoji_type: params.emojiType },
    },
  });
}

export async function listReactionsFeishu(params: {
  cfg: Config;
  accountId?: string;
  messageId: string;
  emojiType?: string;
}): Promise<any> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  const { api } = createFeishuClient(account);
  return await (api as any).im.v1.messageReaction.list({
    path: { message_id: params.messageId },
    params: params.emojiType ? { reaction_type: params.emojiType } : {},
  });
}

export async function removeReactionFeishu(params: {
  cfg: Config;
  accountId?: string;
  messageId: string;
  reactionId: string;
}): Promise<any> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  const { api } = createFeishuClient(account);
  return await (api as any).im.v1.messageReaction.delete({
    path: { message_id: params.messageId, reaction_id: params.reactionId },
  });
}

export async function pinMessageFeishu(params: {
  cfg: Config;
  accountId?: string;
  messageId: string;
}): Promise<any> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  const { api } = createFeishuClient(account);
  return await (api as any).im.v1.pin.create({
    data: { message_id: params.messageId },
  });
}

export async function unpinMessageFeishu(params: {
  cfg: Config;
  accountId?: string;
  messageId: string;
}): Promise<any> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  const { api } = createFeishuClient(account);
  return await (api as any).im.v1.pin.delete({
    path: { message_id: params.messageId },
  });
}

export async function listPinsFeishu(params: {
  cfg: Config;
  accountId?: string;
  chatId: string;
  startTime?: string;
  endTime?: string;
  pageSize?: number;
  pageToken?: string;
}): Promise<any> {
  const account = resolveFeishuAccount(params.cfg, params.accountId ?? 'default');
  const { api } = createFeishuClient(account);
  return await (api as any).im.v1.pin.list({
    params: {
      chat_id: params.chatId,
      ...(params.startTime ? { start_time: params.startTime } : {}),
      ...(params.endTime ? { end_time: params.endTime } : {}),
      ...(params.pageSize ? { page_size: params.pageSize } : {}),
      ...(params.pageToken ? { page_token: params.pageToken } : {}),
    },
  });
}

