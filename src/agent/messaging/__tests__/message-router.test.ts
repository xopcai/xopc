import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { MessageRouter } from '../message-router.js';
import type { InboundMessage } from '../../../infra/bus/index.js';
import { commandRegistry, initializeCommands } from '../../../chat-commands/index.js';

function makeInbound(content: string, conversationId = 'agent:main:telegram:acc:direct:1:u:2'): InboundMessage {
  return {
    channel: 'telegram',
    sender_id: '2',
    chat_id: '1',
    content,
    metadata: { conversationId, isGroup: false },
  };
}

describe('MessageRouter', () => {
  const router = new MessageRouter();

  beforeAll(() => initializeCommands());
  afterAll(() => commandRegistry.clear());

  it.each(['/tmp', '/tmp inspect this folder', '/unknown\n/new'])('routes %s as normal input', async (content) => {
    const result = await router.routeMessage(makeInbound(content));
    expect(result.isCommand).toBe(false);
    expect(result.command).toBeUndefined();
  });

  it('treats /new@BotName as command new', async () => {
    const r = await router.routeMessage(makeInbound('/new@xopc_bot'));
    expect(r.isCommand).toBe(true);
    expect(r.command).toBe('new');
    expect(r.commandArgs).toBe('');
  });

  it('parses args after normalized command', async () => {
    const r = await router.routeMessage(makeInbound('/switch minimax/foo'));
    expect(r.command).toBe('switch');
    expect(r.commandArgs).toBe('minimax/foo');
  });

  it('treats slash command on a line after STT/transcript prefix as command', async () => {
    const r = await router.routeMessage(
      makeInbound('voice transcript here\n\n/tts on'),
    );
    expect(r.isCommand).toBe(true);
    expect(r.command).toBe('tts');
    expect(r.commandArgs).toBe('on');
  });

  it('parses /skills reload when not at start of message', async () => {
    const r = await router.routeMessage(
      makeInbound('note\n/skills reload'),
    );
    expect(r.isCommand).toBe(true);
    expect(r.command).toBe('skills');
    expect(r.commandArgs).toBe('reload');
  });
});
