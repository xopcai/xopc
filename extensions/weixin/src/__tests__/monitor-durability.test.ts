import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelMessageJournal } from '@xopcai/xopc/channels/message-journal.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import { closeXopcDatabase, openXopcDatabase } from '@xopcai/xopc/storage/sqlite/connection.js';

import type { WeixinMessage } from '../api/types.js';
import { clearSessionPause, isSessionPaused, SESSION_EXPIRED_ERRCODE } from '../api/session-guard.js';
import { monitorWeixinProvider } from '../monitor/monitor.js';

const { getUpdates, processWeixinInboundMessage } = vi.hoisted(() => ({
  getUpdates: vi.fn(),
  processWeixinInboundMessage: vi.fn(),
}));
vi.mock('../api/api.js', () => ({ getUpdates }));
vi.mock('../messaging/process-message.js', () => ({ processWeixinInboundMessage }));
vi.mock('../api/config-cache.js', () => ({
  WeixinConfigManager: class { async getForUser() { return {}; } },
}));

describe('Weixin monitor durability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    openXopcDatabase({ path: ':memory:' });
  });
  afterEach(() => { closeXopcDatabase(); });

  it('reports expired credentials as requiring a new login', async () => {
    const account = {
      accountId: 'expired', baseUrl: 'https://fixture.invalid', cdnBaseUrl: 'https://fixture.invalid',
      configured: true, enabled: true, dmPolicy: 'pairing' as const, allowFrom: [], token: 'fixture',
    };
    const controller = new AbortController();
    getUpdates.mockResolvedValue({ errcode: SESSION_EXPIRED_ERRCODE });
    const onState = vi.fn((state: string) => {
      if (state === 'reconnect-required') controller.abort();
    });
    try {
      await monitorWeixinProvider({
        account, config: {} as Config, bus: new MessageBus(), abortSignal: controller.signal, onState,
      });
      expect(onState.mock.calls).toEqual([['connecting'], ['reconnect-required']]);
      expect(isSessionPaused(account.accountId)).toBe(true);
      clearSessionPause(account.accountId);
      expect(isSessionPaused(account.accountId)).toBe(false);
    } finally {
      clearSessionPause(account.accountId);
    }
  });

  it('commits the whole page and continues after a message fails', async () => {
    const account = {
      accountId: 'fixture', baseUrl: 'https://fixture.invalid', cdnBaseUrl: 'https://fixture.invalid',
      configured: true, enabled: true, dmPolicy: 'pairing' as const, allowFrom: [], token: 'fixture',
    };
    const scope = JSON.stringify([account.accountId, account.baseUrl]);
    const journal = new ChannelMessageJournal<WeixinMessage, string>('weixin', scope);
    const controller = new AbortController();
    getUpdates
      .mockResolvedValueOnce({
        ret: 0, get_updates_buf: 'after',
        msgs: [{ message_id: '9007199254740993', from_user_id: 'one' }, { message_id: '9007199254740994', from_user_id: 'one' }],
      })
      .mockImplementationOnce(async () => {
        controller.abort();
        return { ret: 0, get_updates_buf: 'ignored' };
      });
    processWeixinInboundMessage
      .mockImplementationOnce(async () => {
        expect(journal.cursor()).toBe('after');
        throw new Error('attachment unavailable');
      })
      .mockResolvedValueOnce(undefined);
    await monitorWeixinProvider({
      account, config: {} as Config, bus: new MessageBus(), abortSignal: controller.signal,
    });
    expect(processWeixinInboundMessage.mock.calls.map(([message]) => message.message_id)).toEqual(['9007199254740993', '9007199254740994']);
    expect(getUpdates.mock.calls.map(([request]) => request.get_updates_buf)).toEqual(['', 'after']);
    expect(journal.pending()).toEqual([]);
    expect(journal.cursor()).toBe('after');
  });
});
