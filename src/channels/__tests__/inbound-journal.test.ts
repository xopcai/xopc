import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { MessageBus } from '../../infra/bus/index.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { ChannelOutboundSender } from '../outbound-sender.js';
import { ChannelPluginRegistry } from '../plugin-registry.js';
import type { ChannelPlugin } from '../plugin-types.js';
import { ChannelMessageJournal } from '../message-journal.js';
import { verifiedChannelBus, verifiedChannelInbound } from '../verified-inbound.js';

describe('durable channel ingress', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-inbox-'));
    path = join(dir, 'state.db');
    openXopcDatabase({ path });
  });
  afterEach(() => {
    closeXopcDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('restores pending messages and does not replay a handler interrupted during dispatch', () => {
    const journal = new ChannelMessageJournal<string, string>('weixin', 'bot-a');
    journal.accept([{ id: 'one', payload: 'first' }, { id: 'two', payload: 'second' }], 'cursor');
    expect(journal.begin('one')).toBe(true);
    expect(journal.begin('two', true)).toBe(true);
    closeXopcDatabase();
    openXopcDatabase({ path });

    const reopened = new ChannelMessageJournal<string, string>('weixin', 'bot-a');
    expect(reopened.cursor()).toBe('cursor');
    expect(reopened.recoverInterrupted()).toBe(1);
    expect(reopened.pending()).toMatchObject([{ id: 'two', payload: 'second' }]);
    expect(reopened.accept([{ id: 'one', payload: 'duplicate' }])).toEqual([]);
    expect(new ChannelMessageJournal('weixin', 'bot-b').pending()).toEqual([]);
  });

  it('rolls back the accepted cursor and the entire page when the inbox is full', () => {
    const journal = new ChannelMessageJournal<string, string>('telegram', 'bot-a');
    journal.accept([{ id: 'first', payload: 'accepted' }], 'before');
    expect(() => journal.accept(Array.from({ length: 500 }, (_, i) => ({ id: String(i), payload: 'next' })), 'after')).toThrow('capacity');
    expect(journal.cursor()).toBe('before');
    expect(journal.pending()).toMatchObject([{ id: 'first', payload: 'accepted' }]);
  });

  it('keeps an Agent input when the in-memory bus has shut down', async () => {
    const bus = new MessageBus();
    const channel = verifiedChannelBus(bus, 'telegram');
    const message = {
      channel: 'telegram', sender_id: '1', chat_id: '1', content: 'hello',
      metadata: { accountId: 'main', isGroup: false, messageId: '42' },
    };
    bus.shutdown();
    await channel.publishInbound(message, { scope: 'main', id: '42' });
    closeXopcDatabase();
    openXopcDatabase({ path });
    const restored = new MessageBus();
    const restoredChannel = verifiedChannelBus(restored, 'telegram');
    restoredChannel.restoreDurableInbound('telegram', 'main');
    const recovered = await restored.consumeInbound();
    expect(recovered).toEqual(message);
    expect(verifiedChannelInbound(recovered)?.subject).toMatchObject({ accountId: 'main', senderId: '1' });
    expect(restored.beginInboundProcessing(recovered)).toBe(true);
    restored.finishInboundProcessing(recovered, true);
    restoredChannel.restoreDurableInbound('telegram', 'main');
    await restoredChannel.publishInbound(message, { scope: 'main', id: '42' });
    expect(restored.beginInboundProcessing(recovered)).toBe(false);
  });

  it('recovers a queued final reply and leaves ambiguous deliveries interrupted', async () => {
    const registry = new ChannelPluginRegistry();
    const sendText = vi.fn(async () => ({ success: true, messageId: 'remote', chatId: 'chat' }));
    registry.register({ id: 'telegram', outbound: { sendText } } as unknown as ChannelPlugin);
    const makeSender = () => {
      const sender = new ChannelOutboundSender({ registry, getConfig: () => ({} as Config) });
      sender.enablePersistence('agent');
      return sender;
    };
    const response = { channel: 'telegram', chat_id: 'chat', content: 'answer' };
    const sender = makeSender();
    expect(sender.persistReply(response, { scope: 'bot', id: 'pending' })).toBe(true);
    expect(sender.persistReply(response, { scope: 'bot', id: 'in-flight' })).toBe(true);
    const journal = new ChannelMessageJournal('agent-reply', 'agent');
    expect(journal.begin(JSON.stringify(['telegram', 'bot', 'in-flight']))).toBe(true);

    closeXopcDatabase();
    openXopcDatabase({ path });
    const restarted = makeSender();
    await restarted.replayPending();
    await restarted.replayPending();
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(restarted.persistReply(response, { scope: 'bot', id: 'pending' })).toBe(false);
    expect(restarted.persistReply(response, { scope: 'bot', id: 'in-flight' })).toBe(false);
  });

});
