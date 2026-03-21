import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../message-router.js';
import type { InboundMessage } from '../../../bus/index.js';

function makeInbound(content: string, sessionKey = 'telegram:acc:dm:1:u:2'): InboundMessage {
  return {
    channel: 'telegram',
    sender_id: '2',
    chat_id: '1',
    content,
    metadata: { sessionKey, isGroup: false },
  };
}

describe('MessageRouter', () => {
  const router = new MessageRouter({ workspace: '/tmp' });

  it('treats /new@BotName as command new', async () => {
    const r = await router.routeMessage(makeInbound('/new@xopcbot_bot'));
    expect(r.isCommand).toBe(true);
    expect(r.command).toBe('new');
    expect(r.commandArgs).toBe('');
  });

  it('parses args after normalized command', async () => {
    const r = await router.routeMessage(makeInbound('/switch minimax/foo'));
    expect(r.command).toBe('switch');
    expect(r.commandArgs).toBe('minimax/foo');
  });
});
