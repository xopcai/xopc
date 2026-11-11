import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrammyError, type Bot } from 'grammy';
import type { Update } from '@grammyjs/types';

import { ChannelMessageJournal } from '@xopcai/xopc/channels/message-journal.js';
import { closeXopcDatabase, openXopcDatabase } from '@xopcai/xopc/storage/sqlite/connection.js';

import { startTelegramPollingSession } from '../polling-session.js';
import { telegramInboundScope, writeTelegramUpdateOffset } from '../update-offset-store.js';

const accountId = 'default';
const botToken = '1:token';

describe('Telegram polling', () => {
  beforeEach(() => { openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); });

  it('commits the page before dispatch and keeps the cursor through successful empty polls', async () => {
    writeTelegramUpdateOffset({ accountId, botToken, lastUpdateId: 41 });
    const journal = new ChannelMessageJournal<Update, { updateId: number }>('telegram', telegramInboundScope(accountId, botToken));
    const getUpdates = vi.fn()
      .mockResolvedValueOnce([{ update_id: 42 }, { update_id: 43 }])
      .mockResolvedValueOnce([])
      .mockImplementation((_options, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
      }));
    const handleUpdate = vi.fn(async () => {
      expect(journal.cursor()?.updateId).toBe(43);
    });
    const onExit = vi.fn();
    const session = startTelegramPollingSession({ accountId, botToken, bot: { api: { getUpdates }, handleUpdate } as unknown as Bot, onExit });
    try {
      await vi.waitFor(() => expect(getUpdates).toHaveBeenCalledTimes(3));
      expect(handleUpdate.mock.calls).toHaveLength(2);
      expect(getUpdates.mock.calls.map(([options]) => options.offset)).toEqual([42, 44, 44]);
    } finally {
      await session.stop();
    }
    expect(onExit).not.toHaveBeenCalled();
  });

  it('reports a conflicting poller without modifying any webhook', async () => {
    const onExit = vi.fn();
    const getUpdates = vi.fn(async () => {
      throw new GrammyError('getUpdates failed', { ok: false, error_code: 409, description: 'Conflict' }, 'getUpdates', {});
    });
    const deleteWebhook = vi.fn();
    const session = startTelegramPollingSession({
      accountId, botToken, bot: { api: { getUpdates, deleteWebhook } } as unknown as Bot, onExit,
    });
    try {
      await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('webhook') })));
    } finally {
      await session.stop();
    }
    expect(getUpdates).toHaveBeenCalledTimes(1);
    expect(deleteWebhook).not.toHaveBeenCalled();
  });
});
