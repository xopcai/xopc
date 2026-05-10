import {
  appendAllowFromIdSync,
  readAllowFromIdsSync,
  resolveWeixinAllowFromPath,
} from '@xopcai/xopc/channels/pairing/index.js';

export { resolveFrameworkAllowFromPath } from './accounts.js';

export function readFrameworkAllowFromList(accountId: string): string[] {
  return readAllowFromIdsSync(resolveWeixinAllowFromPath(accountId));
}

export async function registerUserInFrameworkStore(params: {
  accountId: string;
  userId: string | number;
}): Promise<{ changed: boolean }> {
  const trimmedUserId = String(typeof params.userId === 'number' ? params.userId : params.userId.trim()).trim();
  if (!trimmedUserId) return { changed: false };
  const changed = appendAllowFromIdSync(resolveWeixinAllowFromPath(params.accountId), trimmedUserId).changed;
  return { changed };
}
