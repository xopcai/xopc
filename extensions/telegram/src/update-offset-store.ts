import { DurableState } from '@xopcai/xopc/storage/sqlite/durable-state.js';

type TelegramUpdateOffsetState = { lastUpdateId: number; botId: string | null };
const state = new DurableState<TelegramUpdateOffsetState>('telegram-offsets');

function accountKey(accountId?: string): string { return accountId?.trim() || 'default'; }
function botId(token?: string): string | null {
  const id = token?.trim().split(':', 1)[0];
  return id && /^\d+$/.test(id) ? id : null;
}

export function readTelegramUpdateOffset(params: { accountId?: string; botToken?: string }): number | undefined {
  const record = state.get(accountKey(params.accountId));
  return record && record.botId === botId(params.botToken) ? record.lastUpdateId : undefined;
}

export function writeTelegramUpdateOffset(params: { accountId?: string; botToken?: string; lastUpdateId: number }): void {
  if (!Number.isSafeInteger(params.lastUpdateId) || params.lastUpdateId < 0) return;
  const id = botId(params.botToken);
  state.update(accountKey(params.accountId), previous => ({
    value: { botId: id, lastUpdateId: previous?.botId === id ? Math.max(previous.lastUpdateId, params.lastUpdateId) : params.lastUpdateId },
    result: undefined,
  }));
}
