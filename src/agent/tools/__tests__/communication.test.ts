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

  it('auto-resolves the default Weixin recipient and verifies delivery in an authorized owner conversation', async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const deliverOutbound = vi.fn().mockResolvedValue(undefined);
    const resolveDefaultTarget = vi.fn().mockResolvedValue({
      ok: true,
      channel: 'weixin',
      chatId: 'alice@im.wechat',
      accountId: 'bot-1',
    });
    const tool = createMessageTool(
      { publishOutbound } as never,
      () => ({ channel: 'webchat', chatId: 'chat-1' }),
      {
        canResolveDefaultTarget: () => true,
        resolveDefaultTarget,
        deliverOutbound,
      },
    );

    const result = await tool.execute('call-1', { content: '你好', channel: 'weixin' });

    expect(resolveDefaultTarget).toHaveBeenCalledWith({ channel: 'weixin', accountId: undefined });
    expect(deliverOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'weixin',
      chat_id: 'alice@im.wechat',
      content: '你好',
      metadata: { accountId: 'bot-1' },
    }));
    expect(publishOutbound).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('Message sent to weixin (alice@im.wechat)');
  });

  it('refuses default recipient lookup outside an authorized owner conversation', async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const resolveDefaultTarget = vi.fn();
    const tool = createMessageTool(
      { publishOutbound } as never,
      () => ({ channel: 'telegram', chatId: 'tg-peer' }),
      {
        canResolveDefaultTarget: () => false,
        resolveDefaultTarget,
      },
    );

    const result = await tool.execute('call-1', { content: 'hi', channel: 'weixin' });

    expect(resolveDefaultTarget).not.toHaveBeenCalled();
    expect(publishOutbound).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('authorized owner conversation');
  });

  it('surfaces real external channel delivery errors instead of reporting success', async () => {
    const publishOutbound = vi.fn().mockResolvedValue(undefined);
    const deliverOutbound = vi.fn().mockRejectedValue(
      new Error('Channel delivery did not succeed: weixin: missing context_token for this user'),
    );
    const tool = createMessageTool(
      { publishOutbound } as never,
      () => ({ channel: 'webchat', chatId: 'chat-1' }),
      {
        deliverOutbound,
      },
    );

    const result = await tool.execute('call-1', {
      content: 'hi',
      channel: 'weixin',
      chat_id: 'alice@im.wechat',
    });

    expect(deliverOutbound).toHaveBeenCalledTimes(1);
    expect(publishOutbound).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('Send error:');
    expect(result.content[0]?.text).toContain('missing context_token');
  });
});
