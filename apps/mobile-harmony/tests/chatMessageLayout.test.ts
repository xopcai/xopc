import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');

describe('chat message layout parity', () => {
  it('renders user messages as compact right-aligned bubbles', () => {
    const start = chat.indexOf("if (item.item.role === 'user')");
    const end = chat.indexOf("} else {", start);
    const userLayout = chat.slice(start, end);

    expect(userLayout).toContain(".id('chat-user-bubble-' + item.item.id)");
    expect(userLayout).toContain(".width(this.userBubbleWidth(item.item))");
    expect(userLayout).toContain("constraintSize({ minWidth: 44, maxWidth: '82%' })");
    expect(userLayout).toContain(".justifyContent(FlexAlign.End)");
    expect(userLayout).toContain(".alignItems(HorizontalAlign.End)");
    expect(userLayout).toContain(".backgroundColor($r('app.color.accent_soft'))");
    expect(userLayout).toContain('bottomRight: 6');
    expect(chat).toContain("if ((row.media?.length || 0) > 0 || (row.refs?.length || 0) > 0) return '82%'");
    expect(chat).toContain("return width >= 262 ? '82%' : width + 'vp'");
  });

  it('keeps assistant messages full-width and transparent', () => {
    expect(chat).not.toContain(".backgroundColor(item.item.role === 'user' ? $r('app.color.panel') : $r('app.color.surface'))");
    expect(chat).toContain("List({ space: 20, scroller: this.messagesScroller })");
    expect(chat).toContain(".padding({ left: 20, right: 20 }).cachedCount(3)");
  });

  it('aligns the action row with the message role without shrinking its touch targets', () => {
    expect(chat).toContain("justifyContent(row.role === 'user' ? FlexAlign.End : FlexAlign.Start)");
    expect(chat).toContain(".width(44).height(44).padding(0).backgroundColor(Color.Transparent)");
  });
});
