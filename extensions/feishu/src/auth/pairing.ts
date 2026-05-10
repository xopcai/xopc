import {
  appendAllowFromIdSync,
  readAllowFromIdsSync,
  resolveStandardAllowFromPath,
} from '@xopcai/xopc/channels/pairing/index.js';

export function readFrameworkAllowFromList(accountId: string): Array<string | number> {
  return readAllowFromIdsSync(resolveStandardAllowFromPath('feishu', accountId));
}

export async function registerUserInFrameworkStore(params: {
  accountId: string;
  userId: string | number;
}): Promise<{ changed: boolean }> {
  const { accountId, userId } = params;
  const id = String(typeof userId === 'number' ? userId : userId.trim());
  if (!id) return { changed: false };
  const changed = appendAllowFromIdSync(resolveStandardAllowFromPath('feishu', accountId), id).changed;
  return { changed };
}

