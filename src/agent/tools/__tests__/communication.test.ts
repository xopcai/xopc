import { describe, expect, it, vi } from 'vitest';

import { createMessageTool } from '../communication.js';

describe('send_message tool', () => {
  it('sends to the current conversation when no destination is provided', async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const tool = createMessageTool(
      { publishOutbound } as never,
      () => ({ channel: 'webchat', chatId: 'chat-1' }),
    );

    await tool.execute('call-1', { content: 'hello' });

    expect(publishOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'webchat',
      chat_id: 'chat-1',
      content: 'hello',
    }));
  });

  it('routes an explicit WebChat send to Weixin with its account', async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const tool = createMessageTool(
      { publishOutbound } as never,
      () => ({ channel: 'webchat', chatId: 'chat-1' }),
    );

    await tool.execute('call-1', {
      content: 'hello weixin',
      channel: 'weixin',
      chat_id: 'wx-peer-1',
      accountId: 'personal',
    });

    expect(publishOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'weixin',
      chat_id: 'wx-peer-1',
      content: 'hello weixin',
      metadata: { accountId: 'personal' },
    }));
  });

  it('rejects a partial explicit destination instead of misrouting it', async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const tool = createMessageTool(
      { publishOutbound } as never,
      () => ({ channel: 'webchat', chatId: 'chat-1' }),
    );

    const result = await tool.execute('call-1', { content: 'hello', channel: 'weixin' });

    expect(publishOutbound).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('channel and chat_id');
  });
});
