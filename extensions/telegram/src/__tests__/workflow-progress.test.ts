import { describe, expect, it, vi } from 'vitest';

import { createTelegramWorkflowProgressCapability } from '../workflow-progress.js';
import type { TelegramAccountManager } from '../account-manager.js';

function mkAccountManager(bot: { api: Record<string, ReturnType<typeof vi.fn>> }) {
  return {
    getBot: vi.fn(() => bot),
  } as unknown as TelegramAccountManager;
}

function mkBot() {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 7777 }),
      editMessageText: vi.fn().mockResolvedValue({ message_id: 7777 }),
    },
  };
}

const DM_SESSION = 'agent:main:telegram:default:direct:916534770';
const GROUP_SESSION = 'agent:main:telegram:group:-1001234567890:thread:55';

describe('telegram workflow progress capability', () => {
  it('declares the expected channel defaults', () => {
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(mkBot()));
    expect(cap.channelId).toBe('telegram');
    expect(cap.supportsEdit).toBe(true);
    expect(cap.defaultMode).toBe('edit');
    expect(cap.defaultThrottleMs).toBeGreaterThanOrEqual(3_000);
  });

  it('sends a new DM message on first call and returns its id', async () => {
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const r = await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'workflow running…',
      isFinal: false,
    });
    expect(bot.api.sendMessage).toHaveBeenCalledWith('916534770', 'workflow running…', expect.any(Object));
    expect(r.messageId).toBe('7777');
  });

  it('edits in place when previousMessageId is provided', async () => {
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const r = await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'updated text',
      previousMessageId: '7777',
      isFinal: false,
    });
    expect(bot.api.editMessageText).toHaveBeenCalledWith('916534770', 7777, 'updated text');
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    expect(r.messageId).toBe('7777');
  });

  it('always sends a fresh message for the final update', async () => {
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'done',
      previousMessageId: '7777',
      isFinal: true,
    });
    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(bot.api.editMessageText).not.toHaveBeenCalled();
  });

  it('passes message_thread_id for group threads on send', async () => {
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    await cap.postProgress({
      sessionKey: GROUP_SESSION,
      text: 'hi',
      isFinal: false,
    });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      '-1001234567890',
      'hi',
      expect.objectContaining({ message_thread_id: 55 }),
    );
  });

  it('treats "message is not modified" as success and keeps id', async () => {
    const bot = mkBot();
    bot.api.editMessageText = vi.fn().mockRejectedValue(
      new Error('Bad Request: message is not modified'),
    );
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const r = await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'same',
      previousMessageId: '7777',
      isFinal: false,
    });
    expect(r.messageId).toBe('7777');
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to sendMessage when edit target is gone', async () => {
    const bot = mkBot();
    bot.api.editMessageText = vi.fn().mockRejectedValue(
      new Error('Bad Request: message to edit not found'),
    );
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const r = await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'rebuild',
      previousMessageId: '7777',
      isFinal: false,
    });
    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(r.messageId).toBe('7777');
  });

  it('rethrows non-recoverable edit errors so the broker can log', async () => {
    const bot = mkBot();
    bot.api.editMessageText = vi.fn().mockRejectedValue(new Error('Too Many Requests: retry after 5'));
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    await expect(
      cap.postProgress({
        sessionKey: DM_SESSION,
        text: 'x',
        previousMessageId: '7777',
        isFinal: false,
      }),
    ).rejects.toThrow(/Too Many Requests/);
  });

  it('throws on unroutable sessionKey', async () => {
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    await expect(
      cap.postProgress({ sessionKey: 'agent:main:webchat:default:direct:abc', text: 'x', isFinal: false }),
    ).rejects.toThrow(/cannot route/);
  });

  it('throws when no bot is registered for that accountId', async () => {
    const mgr = { getBot: vi.fn().mockReturnValue(undefined) } as unknown as TelegramAccountManager;
    const cap = createTelegramWorkflowProgressCapability(mgr);
    await expect(
      cap.postProgress({ sessionKey: DM_SESSION, text: 'x', isFinal: false }),
    ).rejects.toThrow(/no bot/);
  });

  it('clamps oversized text to Telegram limit', async () => {
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const huge = 'x'.repeat(10_000);
    await cap.postProgress({ sessionKey: DM_SESSION, text: huge, isFinal: false });
    const sent = bot.api.sendMessage.mock.calls[0][1] as string;
    expect(sent.length).toBeLessThanOrEqual(4_000);
    expect(sent.endsWith('…')).toBe(true);
  });
});
