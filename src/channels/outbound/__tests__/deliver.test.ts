import { describe, expect, it, vi } from 'vitest';

import type { ChannelPlugin } from '../../plugin-types.js';
import type { OutboundMessage } from '../../transport-types.js';
import { deliverOutboundMessage } from '../deliver.js';

describe('deliverOutboundMessage', () => {
  it('uses sendText for text-only when both sendText and sendMedia exist', async () => {
    const sendText = vi.fn().mockResolvedValue({
      messageId: '1',
      chatId: 'user@im.wechat',
      success: true,
    });
    const sendMedia = vi.fn().mockResolvedValue({
      messageId: '',
      chatId: 'user@im.wechat',
      success: false,
      error: 'No media URL',
    });

    const plugin = {
      id: 'weixin',
      outbound: {
        sendText,
        sendMedia,
      },
    } as unknown as ChannelPlugin;

    const processedMsg: OutboundMessage = {
      channel: 'weixin',
      chat_id: 'user@im.wechat',
      content: 'hello',
    };

    await deliverOutboundMessage({
      cfg: {} as import('../../../config/index.js').Config,
      plugin,
      processedMsg,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it('uses sendMedia when mediaUrl is set', async () => {
    const sendText = vi.fn();
    const sendMedia = vi.fn().mockResolvedValue({
      messageId: '2',
      chatId: 'user@im.wechat',
      success: true,
    });

    const plugin = {
      id: 'weixin',
      outbound: {
        sendText,
        sendMedia,
      },
    } as unknown as ChannelPlugin;

    const processedMsg: OutboundMessage = {
      channel: 'weixin',
      chat_id: 'user@im.wechat',
      content: 'caption',
      mediaUrl: 'https://example.com/a.png',
    };

    await deliverOutboundMessage({
      cfg: {} as import('../../../config/index.js').Config,
      plugin,
      processedMsg,
    });

    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(sendText).not.toHaveBeenCalled();
  });
});
