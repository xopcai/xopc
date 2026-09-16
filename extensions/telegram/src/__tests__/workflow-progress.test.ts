import { requireXopcDatabase as openFixtureDatabase } from '../../../../src/storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../../src/storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("ea56d808-18f3-44f3-8144-29030e98fac0", '', {"agentId":"main","sourceChannel":"telegram","sourceChatId":"916534770","sessionType":"chat","routing":{"agentId":"main","source":"telegram","accountId":"default","peerKind":"direct","peerId":"916534770"}});
  ensureFixtureConversation("658b1db9-4546-4ec7-81b3-35e9aa56a731", '', {"agentId":"main","sourceChannel":"telegram","sourceChatId":"-1001234567890","sessionType":"chat","routing":{"agentId":"main","source":"telegram","accountId":"default","peerKind":"group","peerId":"-1001234567890","threadId":"55"}});
  ensureFixtureConversation("17305fb5-e9c2-4028-8aa3-1b2b6b86fedc", '', {"agentId":"main","sourceChannel":"webchat","sourceChatId":"abc","sessionType":"chat","routing":{"agentId":"main","source":"webchat","accountId":"default","peerKind":"direct","peerId":"abc"}});
}
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

const DM_SESSION = "ea56d808-18f3-44f3-8144-29030e98fac0";
const GROUP_SESSION = "658b1db9-4546-4ec7-81b3-35e9aa56a731";

describe('telegram workflow progress capability', () => {
  it('declares the expected channel defaults', () => {
    seedConversationFixtures();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(mkBot()));
    expect(cap.channelId).toBe('telegram');
    expect(cap.supportsEdit).toBe(true);
    expect(cap.defaultMode).toBe('edit');
    expect(cap.defaultThrottleMs).toBeGreaterThanOrEqual(3_000);
  });

  it('sends a new DM message on first call and returns its id', async () => {
    seedConversationFixtures();
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const r = await cap.postProgress({
      conversationId: DM_SESSION,
      text: 'workflow running…',
      isFinal: false,
    });
    expect(bot.api.sendMessage).toHaveBeenCalledWith('916534770', 'workflow running…', expect.any(Object));
    expect(r.messageId).toBe('7777');
  });

  it('edits in place when previousMessageId is provided', async () => {
    seedConversationFixtures();
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const r = await cap.postProgress({
      conversationId: DM_SESSION,
      text: 'updated text',
      previousMessageId: '7777',
      isFinal: false,
    });
    expect(bot.api.editMessageText).toHaveBeenCalledWith('916534770', 7777, 'updated text');
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    expect(r.messageId).toBe('7777');
  });

  it('always sends a fresh message for the final update', async () => {
    seedConversationFixtures();
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    await cap.postProgress({
      conversationId: DM_SESSION,
      text: 'done',
      previousMessageId: '7777',
      isFinal: true,
    });
    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(bot.api.editMessageText).not.toHaveBeenCalled();
  });

  it('passes message_thread_id for group threads on send', async () => {
    seedConversationFixtures();
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    await cap.postProgress({
      conversationId: GROUP_SESSION,
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
    seedConversationFixtures();
    const bot = mkBot();
    bot.api.editMessageText = vi.fn().mockRejectedValue(
      new Error('Bad Request: message is not modified'),
    );
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const r = await cap.postProgress({
      conversationId: DM_SESSION,
      text: 'same',
      previousMessageId: '7777',
      isFinal: false,
    });
    expect(r.messageId).toBe('7777');
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to sendMessage when edit target is gone', async () => {
    seedConversationFixtures();
    const bot = mkBot();
    bot.api.editMessageText = vi.fn().mockRejectedValue(
      new Error('Bad Request: message to edit not found'),
    );
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const r = await cap.postProgress({
      conversationId: DM_SESSION,
      text: 'rebuild',
      previousMessageId: '7777',
      isFinal: false,
    });
    expect(bot.api.sendMessage).toHaveBeenCalled();
    expect(r.messageId).toBe('7777');
  });

  it('rethrows non-recoverable edit errors so the broker can log', async () => {
    seedConversationFixtures();
    const bot = mkBot();
    bot.api.editMessageText = vi.fn().mockRejectedValue(new Error('Too Many Requests: retry after 5'));
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    await expect(
      cap.postProgress({
        conversationId: DM_SESSION,
        text: 'x',
        previousMessageId: '7777',
        isFinal: false,
      }),
    ).rejects.toThrow(/Too Many Requests/);
  });

  it('throws on unroutable conversationId', async () => {
    seedConversationFixtures();
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    await expect(
      cap.postProgress({ conversationId: "17305fb5-e9c2-4028-8aa3-1b2b6b86fedc", text: 'x', isFinal: false }),
    ).rejects.toThrow(/cannot route/);
  });

  it('throws when no bot is registered for that accountId', async () => {
    seedConversationFixtures();
    const mgr = { getBot: vi.fn().mockReturnValue(undefined) } as unknown as TelegramAccountManager;
    const cap = createTelegramWorkflowProgressCapability(mgr);
    await expect(
      cap.postProgress({ conversationId: DM_SESSION, text: 'x', isFinal: false }),
    ).rejects.toThrow(/no bot/);
  });

  it('clamps oversized text to Telegram limit', async () => {
    seedConversationFixtures();
    const bot = mkBot();
    const cap = createTelegramWorkflowProgressCapability(mkAccountManager(bot));
    const huge = 'x'.repeat(10_000);
    await cap.postProgress({ conversationId: DM_SESSION, text: huge, isFinal: false });
    const sent = bot.api.sendMessage.mock.calls[0][1] as string;
    expect(sent.length).toBeLessThanOrEqual(4_000);
    expect(sent.endsWith('…')).toBe(true);
  });
});
