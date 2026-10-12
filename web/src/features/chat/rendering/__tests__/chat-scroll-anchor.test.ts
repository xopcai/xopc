// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { readChatScrollAnchor, restoreChatScrollAnchor } from '@/features/chat/scroll/chat-scroll-anchor';

describe('chat reading anchor', () => {
  it('preserves the same visible row when history or asynchronous content changes height', () => {
    const root = document.createElement('div');
    root.getBoundingClientRect = () => ({ top: 100, bottom: 500 }) as DOMRect;
    const row = document.createElement('div');
    row.dataset.chatMessageRow = '';
    row.dataset.messageRenderKey = 'stable-row';
    let documentTop = 80;
    row.getBoundingClientRect = () => ({ top: documentTop - root.scrollTop, bottom: documentTop - root.scrollTop + 150 }) as DOMRect;
    root.append(row);
    const anchor = readChatScrollAnchor(root);
    expect(anchor).toEqual({ rowId: 'stable-row', offset: -20 });
    documentTop += 235;
    expect(restoreChatScrollAnchor(root, anchor)).toBe(true);
    expect(root.scrollTop).toBe(235);
    documentTop += 72;
    restoreChatScrollAnchor(root, anchor);
    expect(root.scrollTop).toBe(307);
    expect(readChatScrollAnchor(root)).toEqual(anchor);
  });
});
