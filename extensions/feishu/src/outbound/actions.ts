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
  await (api as any).im.message.patch({
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

