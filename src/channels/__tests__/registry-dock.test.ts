import { describe, it, expect } from 'vitest';
import {
  CHAT_CHANNEL_ORDER,
  getChatChannelMeta,
  isChatChannelId,
  listChatChannelMeta,
} from '../registry.js';
import { getChannelDock, getDockForBuiltinChannel } from '../dock.js';

describe('registry', () => {
  it('orders builtin chat channels', () => {
    expect(CHAT_CHANNEL_ORDER).toContain('telegram');
  });

  it('getChatChannelMeta returns telegram', () => {
    const m = getChatChannelMeta('telegram');
    expect(m.id).toBe('telegram');
    expect(m.label).toBe('Telegram');
    expect(m.capabilities.nativeCommands).toBe(true);
  });

  it('isChatChannelId narrows', () => {
    expect(isChatChannelId('telegram')).toBe(true);
    expect(isChatChannelId('unknown')).toBe(false);
  });

  it('listChatChannelMeta matches order', () => {
    const list = listChatChannelMeta();
    expect(list.map((x) => x.id)).toEqual([...CHAT_CHANNEL_ORDER]);
  });
});

describe('dock', () => {
  it('getChannelDock exposes telegram limits', () => {
    const d = getChannelDock('telegram');
    expect(d?.outbound?.textChunkLimit).toBe(4000);
    expect(d?.queue?.debounceMs).toBe(300);
  });

  it('getDockForBuiltinChannel returns dock', () => {
    const d = getDockForBuiltinChannel('telegram');
    expect(d.id).toBe('telegram');
  });

  it('returns undefined for unknown id', () => {
    expect(getChannelDock('feishu')).toBeUndefined();
  });
});
